require("../helpers/env");

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch, replyByUrl } = require("../helpers/fetch-mock");
const handler = require("../../api/picks/[action].js");

const NUM_TEAMS = 12;

function call({ action, body, method = "POST", admin = true, headers } = {}) {
  const res = makeRes();
  return handler(makeReq({ method, body, query: { action }, admin, headers }), res).then(() => res);
}

describe("api/picks/[action]", () => {
  let fetchMock = null;
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
  });

  describe("routing and gating", () => {
    test("405s on anything but POST", async () => {
      fetchMock = installFetch();
      const res = await call({ action: "add", method: "GET" });
      assert.equal(res.statusCode, 405);
      assert.deepEqual(res.body, { error: "Use POST." });
      assert.equal(fetchMock.calls.length, 0);
    });

    test("401s without the admin password", async () => {
      fetchMock = installFetch();
      const res = await call({ action: "add", admin: false, body: {} });
      assert.equal(res.statusCode, 401);
      assert.equal(fetchMock.calls.length, 0);
    });

    test("404s on an unknown action", async () => {
      fetchMock = installFetch();
      const res = await call({ action: "explode", body: {} });
      assert.equal(res.statusCode, 404);
      assert.deepEqual(res.body, { error: "Unknown picks action." });
    });

    test("turns a thrown Supabase error into a 500 with its message", async () => {
      fetchMock = installFetch(() => ({ status: 503, body: "upstream down" }));
      const res = await call({
        action: "add",
        body: { round: 1, slot: 1, player: "Anyone", numTeams: NUM_TEAMS }
      });
      assert.equal(res.statusCode, 500);
      assert.match(res.body.error, /503 upstream down/);
    });
  });

  describe("add", () => {
    test("rejects a body missing any required field", async () => {
      fetchMock = installFetch();
      for (const body of [
        undefined,
        {},
        { slot: 1, player: "X", numTeams: NUM_TEAMS },
        { round: 1, player: "X", numTeams: NUM_TEAMS },
        { round: 1, slot: 1, numTeams: NUM_TEAMS },
        { round: 1, slot: 1, player: "X" }
      ]) {
        const res = await call({ action: "add", body });
        assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`);
        assert.match(res.body.error, /round, slot, player, and numTeams are required/);
      }
      assert.equal(fetchMock.calls.length, 0);
    });

    test("numbers an odd round left-to-right and restarts the clock", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({
        action: "add",
        body: {
          round: 3,
          slot: 4,
          player: "Ja'Marr Chase",
          position: "WR",
          nflTeam: "CIN",
          team: "Team Four",
          numTeams: NUM_TEAMS
        }
      });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { overallPick: 28 }); // (3-1)*12 + 4
      const [insert, clock] = fetchMock.calls;
      assert.match(insert.url, /draft_picks$/);
      assert.equal(insert.headers.Prefer, "resolution=merge-duplicates");
      assert.deepEqual(insert.body, [
        {
          overall_pick: 28,
          round: 3,
          slot: 4,
          team: "Team Four",
          player: "Ja'Marr Chase",
          position: "WR",
          nfl_team: "CIN",
          source: "manual"
        }
      ]);
      assert.match(clock.url, /draft_config\?id=eq\.1$/);
      assert.equal(clock.method, "PATCH");
      assert.equal(clock.body.clock_state.pausedAt, null);
      assert.ok(clock.body.clock_state.startedAt);
    });

    test("snakes an even round right-to-left", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({
        action: "add",
        body: { round: 2, slot: 1, player: "Last Of Round Two", numTeams: NUM_TEAMS }
      });
      // Slot 1 picks last in an even round: 12 + (12 + 1 - 1) = 24.
      assert.deepEqual(res.body, { overallPick: 24 });
      assert.equal(fetchMock.calls[0].body[0].slot, 1);
    });

    test("fills in the defaults for team, position and NFL team", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      await call({ action: "add", body: { round: 1, slot: 7, player: "Unlabelled", numTeams: NUM_TEAMS } });

      const [row] = fetchMock.calls[0].body;
      assert.equal(row.team, "Slot 7");
      assert.equal(row.position, "");
      assert.equal(row.nfl_team, "");
    });

    test("stores a keeper as such and leaves the clock alone", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({
        action: "add",
        body: { round: 5, slot: 2, player: "Kept Guy", numTeams: NUM_TEAMS, source: "keeper" }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(fetchMock.calls.length, 1, "a keeper must not touch the clock");
      assert.equal(fetchMock.calls[0].body[0].source, "keeper");
    });

    test("only 'keeper' is honoured from the client — anything else is a manual pick", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      await call({
        action: "add",
        body: { round: 1, slot: 1, player: "Spoofed", numTeams: NUM_TEAMS, source: "yahoo" }
      });
      assert.equal(fetchMock.calls[0].body[0].source, "manual");
    });

    test("restartClock:false corrects a pick without handing everyone a fresh clock", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      await call({
        action: "add",
        body: { round: 1, slot: 3, player: "Typo Fixed", numTeams: NUM_TEAMS, restartClock: false }
      });
      assert.equal(fetchMock.calls.length, 1);
    });

    test("restartClock:true is the same as omitting it", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      await call({
        action: "add",
        body: { round: 1, slot: 3, player: "Normal Pick", numTeams: NUM_TEAMS, restartClock: true }
      });
      assert.equal(fetchMock.calls.length, 2);
    });
  });

  describe("remove", () => {
    test("rejects anything that isn't a positive integer pick number", async () => {
      fetchMock = installFetch();
      for (const body of [undefined, {}, { overallPick: 0 }, { overallPick: -3 }, { overallPick: 2.5 }, { overallPick: "abc" }]) {
        const res = await call({ action: "remove", body });
        assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`);
        assert.match(res.body.error, /positive integer/);
      }
      assert.equal(fetchMock.calls.length, 0);
    });

    test("accepts a numeric string, deletes the row and echoes it back", async () => {
      const row = { overall_pick: 14, team: "Team Two", player: "Bijan Robinson", source: "manual" };
      fetchMock = installFetch((c) => (c.method === "DELETE" ? { body: "" } : { body: [row] }));

      const res = await call({ action: "remove", body: { overallPick: "14" } });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { removed: row });
      assert.equal(fetchMock.calls[1].method, "DELETE");
      assert.match(fetchMock.calls[1].url, /draft_picks\?overall_pick=eq\.14$/);
    });

    test("is a no-op when that pick isn't on the board", async () => {
      fetchMock = installFetch(() => ({ body: [] }));
      const res = await call({ action: "remove", body: { overallPick: 99 } });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { removed: null });
      assert.equal(fetchMock.calls.length, 1, "nothing to delete means no DELETE");
    });

    test("is a no-op when the query comes back empty", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ action: "remove", body: { overallPick: 99 } });
      assert.deepEqual(res.body, { removed: null });
    });
  });

  describe("undo", () => {
    test("deletes the highest non-keeper pick and restarts the clock", async () => {
      const last = { overall_pick: 31, team: "Team Six", player: "Latest Pick" };
      fetchMock = installFetch((c) => (c.method === "GET" ? { body: [last] } : { body: "" }));

      const res = await call({ action: "undo", body: {} });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { removed: last });

      const [query, del, clock] = fetchMock.calls;
      assert.match(query.url, /source=neq\.keeper&order=overall_pick\.desc&limit=1$/);
      assert.equal(del.method, "DELETE");
      assert.match(del.url, /overall_pick=eq\.31$/);
      assert.equal(clock.method, "PATCH");
      assert.equal(clock.body.clock_state.pausedAt, null);
    });

    test("does nothing on an empty board", async () => {
      fetchMock = installFetch(() => ({ body: [] }));
      const res = await call({ action: "undo", body: {} });
      assert.deepEqual(res.body, { removed: null });
      assert.equal(fetchMock.calls.length, 1);
    });

    test("does nothing when the query comes back null", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ action: "undo", body: {} });
      assert.deepEqual(res.body, { removed: null });
    });
  });

  describe("reset", () => {
    const config = (cfg) =>
      replyByUrl({
        "draft_config?select=": { body: [cfg] },
        "draft_picks?": (c) => (c.method === "DELETE" ? { body: [{ overall_pick: 1 }, { overall_pick: 2 }] } : { body: "" }),
        "draft_config?id=eq.1": { body: "" }
      });

    test("refuses to wipe a live draft whose date has passed", async () => {
      fetchMock = installFetch(config({ draft_mode: "live", draft_date: "August 24, 2020 at 7:00 PM" }));
      const res = await call({ action: "reset", body: {} });

      assert.equal(res.statusCode, 403);
      assert.match(res.body.error, /Live mode and its draft date has passed/);
      assert.equal(fetchMock.calls.length, 1, "the guard must fire before any delete");
    });

    test("allows a live reset before the draft date", async () => {
      fetchMock = installFetch(config({ draft_mode: "live", draft_date: "August 24, 2099 at 7:00 PM" }));
      const res = await call({ action: "reset", body: {} });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { ok: true, removed: 2, mode: "live", includeKeepers: false });
    });

    test("allows a live reset while the date is still TBD", async () => {
      fetchMock = installFetch(config({ draft_mode: "live", draft_date: "TBD – fourth weekend of August" }));
      const res = await call({ action: "reset", body: {} });
      assert.equal(res.statusCode, 200);
    });

    test("defaults to live mode when draft_config has never been written", async () => {
      fetchMock = installFetch(
        replyByUrl({
          "draft_config?select=": { body: [] },
          "draft_picks?": { body: [] },
          "draft_config?id=eq.1": { body: "" }
        })
      );
      const res = await call({ action: "reset", body: {} });
      assert.equal(res.body.mode, "live");
      assert.equal(res.body.removed, 0);
    });

    test("treats a null config response as live mode too", async () => {
      fetchMock = installFetch(
        replyByUrl({
          "draft_config?select=": { body: "" },
          "draft_picks?": { body: "" },
          "draft_config?id=eq.1": { body: "" }
        })
      );
      const res = await call({ action: "reset", body: {} });
      assert.equal(res.body.mode, "live");
      assert.equal(res.body.removed, 0, "a null delete response counts as nothing removed");
    });

    test("tolerates a missing body", async () => {
      fetchMock = installFetch(config({ draft_mode: "testing" }));
      const res = await call({ action: "reset" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.includeKeepers, false);
    });

    test("skips the date guard entirely in mock mode", async () => {
      fetchMock = installFetch(config({ draft_mode: "mock", draft_date: "August 24, 2020 at 7:00 PM" }));
      const res = await call({ action: "reset", body: {} });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.mode, "mock");
    });

    test("keeps keepers by default and wipes them when asked", async () => {
      fetchMock = installFetch(config({ draft_mode: "testing" }));
      await call({ action: "reset", body: {} });
      assert.match(fetchMock.calls[1].url, /draft_picks\?source=neq\.keeper$/);
      fetchMock.restore();

      fetchMock = installFetch(config({ draft_mode: "testing" }));
      const res = await call({ action: "reset", body: { includeKeepers: true } });
      assert.match(fetchMock.calls[1].url, /draft_picks\?overall_pick=gte\.1$/);
      assert.equal(res.body.includeKeepers, true);
    });

    test("only an exact true includes keepers", async () => {
      fetchMock = installFetch(config({ draft_mode: "testing" }));
      const res = await call({ action: "reset", body: { includeKeepers: "yes" } });
      assert.equal(res.body.includeKeepers, false);
      assert.match(fetchMock.calls[1].url, /source=neq\.keeper$/);
    });

    test("clears the clock so an empty board has no stale deadline", async () => {
      fetchMock = installFetch(config({ draft_mode: "testing" }));
      await call({ action: "reset", body: {} });
      const clockCall = fetchMock.calls.at(-1);
      assert.equal(clockCall.method, "PATCH");
      assert.deepEqual(clockCall.body, { clock_state: {} });
    });
  });
});
