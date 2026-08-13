require("../helpers/env");

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch } = require("../helpers/fetch-mock");
const envelope = require("../helpers/yahoo-envelope");
const handler = require("../../api/yahoo/sync.js");

const LEAGUE = "nfl.l.1";
const NUM_TEAMS = 4;

function call({ method = "POST", admin = true } = {}) {
  const res = makeRes();
  return handler(makeReq({ method, body: {}, admin }), res).then(() => res);
}

const validToken = {
  body: [{ access_token: "at", refresh_token: "rt", expires_at: new Date(Date.now() + 6e5).toISOString() }]
};

const teamFields = (n) => ({ team_key: `${LEAGUE}.t.${n}`, name: `Team ${n}` });
const playerFields = (n) => ({
  player_key: `nfl.p.${n}`,
  name: { full: `Player ${n}` },
  display_position: "WR",
  editorial_team_abbr: "CIN"
});

// Routes the whole sync conversation: Yahoo's three endpoints plus the two
// Supabase tables. `overrides` replaces any one of them.
function syncRoutes({ picks, teams, players, config, onPlayersRequest } = {}) {
  return (call) => {
    if (call.url.includes("yahoo_tokens")) return validToken;
    if (call.url.includes("/draftresults")) return { body: envelope.draftResults(picks || []) };
    if (call.url.includes("/teams")) return { body: envelope.teams(teams || []) };
    if (call.url.includes("/players")) {
      if (onPlayersRequest) onPlayersRequest(call);
      const keys = decodeURIComponent(call.url).match(/player_keys=([^?&]+)/)[1].split(",");
      const known = players || keys.map((key) => ({ ...playerFields(0), player_key: key }));
      return { body: envelope.players(known.filter((p) => keys.includes(p.player_key))) };
    }
    if (call.url.includes("draft_config")) return { body: config === undefined ? [] : config };
    if (call.url.includes("draft_picks")) return { body: "" };
    throw new Error(`No mock route matched ${call.url}`);
  };
}

describe("api/yahoo/sync", () => {
  let fetchMock = null;
  beforeEach(() => {
    process.env.YAHOO_LEAGUE_KEY = LEAGUE;
  });
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
    delete process.env.YAHOO_LEAGUE_KEY;
  });

  test("405s on anything but POST", async () => {
    fetchMock = installFetch();
    const res = await call({ method: "GET" });
    assert.equal(res.statusCode, 405);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("401s without the admin password", async () => {
    fetchMock = installFetch();
    const res = await call({ admin: false });
    assert.equal(res.statusCode, 401);
  });

  test("500s when the league key isn't configured", async () => {
    delete process.env.YAHOO_LEAGUE_KEY;
    fetchMock = installFetch();
    const res = await call({});
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /YAHOO_LEAGUE_KEY is not set/);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("stops early — and doesn't clear anything — when Yahoo has no picks yet", async () => {
    fetchMock = installFetch(syncRoutes({ picks: [] }));
    const res = await call({});

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { synced: 0, message: "Yahoo has no draft picks yet." });
    assert.ok(!fetchMock.calls.some((c) => c.url.includes("draft_picks")));
  });

  test("maps Yahoo picks onto draft_picks rows, snaking the slots", async () => {
    const picks = [
      { pick: 1, round: 1, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.1" },
      { pick: 4, round: 1, team_key: `${LEAGUE}.t.4`, player_key: "nfl.p.4" },
      { pick: 5, round: 2, team_key: `${LEAGUE}.t.4`, player_key: "nfl.p.5" },
      { pick: 8, round: 2, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.8" }
    ];
    fetchMock = installFetch(
      syncRoutes({
        picks,
        teams: [1, 2, 3, 4].map(teamFields),
        players: [1, 4, 5, 8].map(playerFields),
        config: [{ teams: [] }]
      })
    );

    const res = await call({});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { synced: 4 });

    const upsert = fetchMock.calls.find((c) => c.url.includes("draft_picks"));
    assert.equal(upsert.headers.Prefer, "resolution=merge-duplicates");
    assert.deepEqual(
      upsert.body.map((p) => [p.overall_pick, p.round, p.slot]),
      [
        [1, 1, 1],
        [4, 1, 4],
        // Round 2 snakes back: pick 5 is slot 4, pick 8 is slot 1.
        [5, 2, 4],
        [8, 2, 1]
      ]
    );
    assert.deepEqual(upsert.body[0], {
      overall_pick: 1,
      round: 1,
      slot: 1,
      team: "Team 1",
      player: "Player 1",
      position: "WR",
      nfl_team: "CIN",
      source: "yahoo"
    });
  });

  test("falls back to the raw keys when Yahoo can't name a team or player", async () => {
    fetchMock = installFetch(
      syncRoutes({
        picks: [{ pick: 1, round: 1, team_key: "unknown.team", player_key: "nfl.p.99" }],
        teams: [teamFields(1)],
        players: [], // the lookup returns nothing for nfl.p.99
        config: []
      })
    );

    const res = await call({});
    const [row] = fetchMock.calls.find((c) => c.url.includes("draft_picks")).body;
    assert.equal(row.team, "unknown.team");
    assert.equal(row.player, "nfl.p.99");
    assert.equal(row.position, "");
    assert.equal(row.nfl_team, "");
    assert.equal(res.body.synced, 1);
  });

  test("uses the player key as the name when Yahoo omits the name object", async () => {
    fetchMock = installFetch(
      syncRoutes({
        picks: [{ pick: 1, round: 1, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.7" }],
        teams: [teamFields(1)],
        players: [{ player_key: "nfl.p.7", display_position: "QB", editorial_team_abbr: "BUF" }],
        config: []
      })
    );

    await call({});
    const [row] = fetchMock.calls.find((c) => c.url.includes("draft_picks")).body;
    assert.equal(row.player, "nfl.p.7");
    assert.equal(row.position, "QB");
  });

  test("blanks a position or NFL team Yahoo didn't send for a player it did name", async () => {
    fetchMock = installFetch(
      syncRoutes({
        picks: [{ pick: 1, round: 1, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.7" }],
        teams: [teamFields(1)],
        players: [{ player_key: "nfl.p.7", name: { full: "Bare Record" } }],
        config: []
      })
    );

    await call({});
    const [row] = fetchMock.calls.find((c) => c.url.includes("draft_picks")).body;
    assert.equal(row.player, "Bare Record");
    assert.equal(row.position, "");
    assert.equal(row.nfl_team, "");
  });

  test("copes with an empty team record inside Yahoo's envelope", async () => {
    fetchMock = installFetch((call) => {
      if (call.url.includes("yahoo_tokens")) return validToken;
      if (call.url.includes("/draftresults")) {
        return {
          body: envelope.draftResults([{ pick: 1, round: 1, team_key: "t.1", player_key: "nfl.p.1" }])
        };
      }
      if (call.url.includes("/teams")) {
        return { body: { fantasy_content: { league: [{}, { teams: { 0: { team: [] }, count: 1 } }] } } };
      }
      if (call.url.includes("/players")) return { body: envelope.players([playerFields(1)]) };
      if (call.url.includes("draft_config")) return { body: [] };
      return { body: "" };
    });

    const res = await call({});
    assert.equal(res.statusCode, 200);
    const [row] = fetchMock.calls.find((c) => c.url.includes("draft_picks")).body;
    assert.equal(row.team, "t.1", "an unnamed team falls back to its key");
  });

  test("batches player lookups 25 at a time and de-duplicates the keys", async () => {
    const picks = [];
    for (let i = 1; i <= 30; i++) {
      picks.push({ pick: i, round: 1, team_key: `${LEAGUE}.t.1`, player_key: `nfl.p.${i}` });
    }
    // A repeated key (Yahoo can echo one on a corrected pick) must not widen a batch.
    picks.push({ pick: 31, round: 2, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.1" });
    // A pick with no player key at all is skipped by the lookup.
    picks.push({ pick: 32, round: 2, team_key: `${LEAGUE}.t.1` });

    const batches = [];
    fetchMock = installFetch(
      syncRoutes({
        picks,
        teams: [1, 2, 3, 4].map(teamFields),
        players: Array.from({ length: 30 }, (_, i) => playerFields(i + 1)),
        config: [],
        onPlayersRequest: (c) => batches.push(decodeURIComponent(c.url).match(/player_keys=([^?&]+)/)[1].split(","))
      })
    );

    const res = await call({});
    assert.equal(res.statusCode, 200);
    assert.equal(batches.length, 2, "30 unique keys is two batches");
    assert.equal(batches[0].length, 25);
    assert.equal(batches[1].length, 5);
    assert.equal(res.body.synced, 32);
  });

  test("backfills the owner per slot from round 1 without dropping hand-entered managers", async () => {
    fetchMock = installFetch(
      syncRoutes({
        picks: [
          { pick: 1, round: 1, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.1" },
          { pick: 2, round: 1, team_key: `${LEAGUE}.t.2`, player_key: "nfl.p.2" }
        ],
        teams: [1, 2, 3, 4].map(teamFields),
        players: [1, 2].map(playerFields),
        config: [
          {
            teams: [
              { slot: 1, owner: "old name", manager: "Nick" },
              { slot: 2, owner: "old name", manager: "Sam" },
              { slot: 3, owner: "Untouched", manager: "Pat" }
            ]
          }
        ]
      })
    );

    await call({});
    const patch = fetchMock.calls.filter((c) => c.method === "PATCH").at(-1);
    assert.match(patch.url, /draft_config\?id=eq\.1$/);
    assert.deepEqual(patch.body.teams, [
      { slot: 1, owner: "Team 1", manager: "Nick" },
      { slot: 2, owner: "Team 2", manager: "Sam" },
      { slot: 3, owner: "Untouched", manager: "Pat" }
    ]);
  });

  test("skips the backfill when there are no round-1 picks to read it from", async () => {
    fetchMock = installFetch(
      syncRoutes({
        picks: [{ pick: 5, round: 2, team_key: `${LEAGUE}.t.4`, player_key: "nfl.p.5" }],
        teams: [1, 2, 3, 4].map(teamFields),
        players: [playerFields(5)],
        config: [{ teams: [{ slot: 1, owner: "Nick" }] }]
      })
    );

    await call({});
    assert.ok(!fetchMock.calls.some((c) => c.method === "PATCH"), "nothing to backfill means no config write");
  });

  test("tolerates a draft_config row that has no teams yet", async () => {
    fetchMock = installFetch(
      syncRoutes({
        picks: [{ pick: 1, round: 1, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.1" }],
        teams: [teamFields(1)],
        players: [playerFields(1)],
        config: [{}]
      })
    );

    await call({});
    const patch = fetchMock.calls.filter((c) => c.method === "PATCH").at(-1);
    assert.deepEqual(patch.body.teams, []);
  });

  test("tolerates a null draft_config response", async () => {
    fetchMock = installFetch((call) => {
      if (call.url.includes("draft_config") && call.method === "GET") return { body: "" };
      return syncRoutes({
        picks: [{ pick: 1, round: 1, team_key: `${LEAGUE}.t.1`, player_key: "nfl.p.1" }],
        teams: [teamFields(1)],
        players: [playerFields(1)]
      })(call);
    });

    const res = await call({});
    assert.equal(res.statusCode, 200);
  });

  test("500s with the raw reason when Yahoo's envelope isn't what we expect", async () => {
    fetchMock = installFetch((call) => {
      if (call.url.includes("yahoo_tokens")) return validToken;
      return { body: { fantasy_content: { league: [{}] } } };
    });

    const res = await call({});
    assert.equal(res.statusCode, 500);
    assert.ok(res.body.error, "the message is what the Vercel logs will show");
  });
});
