require("../helpers/env");

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch, replyByUrl } = require("../helpers/fetch-mock");
const handler = require("../../api/mock/[action].js");

const NUM_TEAMS = 10;

function call({ action, body, method = "POST" } = {}) {
  const res = makeRes();
  // No admin header on purpose: these routes are deliberately unauthenticated.
  return handler(makeReq({ method, body, query: { action }, admin: false }), res).then(() => res);
}

const active = (extra = {}) => ({ body: [{ active: true, clock_state: {}, ...extra }] });

describe("api/mock/[action]", () => {
  let fetchMock = null;
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
  });

  test("every write stays inside the mock tables", () => {
    const source = require("node:fs").readFileSync(require.resolve("../../api/mock/[action].js"), "utf8");
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /(?<!mock_)draft_picks|(?<!mock_)draft_config/);
  });

  describe("routing", () => {
    test("405s on anything but POST", async () => {
      fetchMock = installFetch();
      const res = await call({ action: "start", method: "GET" });
      assert.equal(res.statusCode, 405);
      assert.equal(fetchMock.calls.length, 0);
    });

    test("404s on an unknown action", async () => {
      fetchMock = installFetch();
      const res = await call({ action: "nope", body: {} });
      assert.equal(res.statusCode, 404);
      assert.deepEqual(res.body, { error: "Unknown mock action." });
    });

    test("runs without an admin password", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ action: "start", body: {} });
      assert.equal(res.statusCode, 200);
    });

    test("turns a thrown error into a 500", async () => {
      fetchMock = installFetch(() => ({ status: 500, body: "table missing" }));
      const res = await call({ action: "start", body: {} });
      assert.equal(res.statusCode, 500);
      assert.match(res.body.error, /table missing/);
    });
  });

  describe("pick", () => {
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
        const res = await call({ action: "pick", body });
        assert.equal(res.statusCode, 400);
      }
      assert.equal(fetchMock.calls.length, 0, "validation happens before the state read");
    });

    test("409s when no rehearsal is running", async () => {
      fetchMock = installFetch(() => ({ body: [{ active: false }] }));
      const res = await call({
        action: "pick",
        body: { round: 1, slot: 1, player: "Stale Tab", numTeams: NUM_TEAMS }
      });
      assert.equal(res.statusCode, 409);
      assert.match(res.body.error, /No mock draft is running/);
      assert.equal(fetchMock.calls.length, 1);
    });

    test("records an odd-round pick and restarts the mock clock", async () => {
      fetchMock = installFetch(replyByUrl({ mock_draft_state: active(), mock_draft_picks: { body: "" } }));
      const res = await call({
        action: "pick",
        body: {
          round: 1,
          slot: 3,
          player: "Bijan Robinson",
          position: "RB",
          nflTeam: "ATL",
          team: "Team Three",
          numTeams: NUM_TEAMS
        }
      });

      assert.deepEqual(res.body, { overallPick: 3 });
      const insert = fetchMock.calls.find((c) => c.url.includes("mock_draft_picks"));
      assert.equal(insert.headers.Prefer, "resolution=merge-duplicates");
      assert.deepEqual(insert.body, [
        {
          overall_pick: 3,
          round: 1,
          slot: 3,
          team: "Team Three",
          player: "Bijan Robinson",
          position: "RB",
          nfl_team: "ATL"
        }
      ]);
      const clock = fetchMock.calls.at(-1);
      assert.equal(clock.method, "PATCH");
      assert.equal(clock.body.clock_state.pausedAt, null);
    });

    test("snakes an even round and fills in the defaults", async () => {
      fetchMock = installFetch(replyByUrl({ mock_draft_state: active(), mock_draft_picks: { body: "" } }));
      const res = await call({
        action: "pick",
        body: { round: 2, slot: 3, player: "Unlabelled", numTeams: NUM_TEAMS }
      });

      // Even round: slot 3 picks 10 + 1 - 3 = 8th, so overall 18.
      assert.deepEqual(res.body, { overallPick: 18 });
      const [row] = fetchMock.calls.find((c) => c.url.includes("mock_draft_picks")).body;
      assert.equal(row.team, "Slot 3");
      assert.equal(row.position, "");
      assert.equal(row.nfl_team, "");
    });
  });

  describe("start", () => {
    test("clears the previous run before flipping active on", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const before = Date.now();
      const res = await call({ action: "start", body: {} });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.active, true);
      assert.ok(new Date(res.body.startedAt).getTime() >= before);

      const [clear, patch] = fetchMock.calls;
      assert.equal(clear.method, "DELETE");
      assert.match(clear.url, /mock_draft_picks\?overall_pick=gte\.0$/);
      assert.equal(patch.method, "PATCH");
      assert.equal(patch.body.active, true);
      assert.equal(patch.body.clock_state.startedAt, res.body.startedAt);
      assert.equal(patch.body.clock_state.pausedAt, null);
    });
  });

  describe("stop", () => {
    test("ends the rehearsal and clears the board by default", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ action: "stop", body: {} });

      assert.deepEqual(res.body, { active: false, cleared: true });
      const [patch, clear] = fetchMock.calls;
      assert.equal(patch.body.active, false);
      assert.deepEqual(patch.body.clock_state, {});
      assert.equal(clear.method, "DELETE");
    });

    test("keepPicks leaves the finished board up", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ action: "stop", body: { keepPicks: true } });
      assert.deepEqual(res.body, { active: false, cleared: false });
      assert.equal(fetchMock.calls.length, 1);
    });

    test("tolerates a missing body", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ action: "stop" });
      assert.deepEqual(res.body, { active: false, cleared: true });
    });
  });

  describe("undo", () => {
    test("removes the last mock pick and restarts the clock", async () => {
      const last = { overall_pick: 7, team: "Team Seven", player: "Undone" };
      fetchMock = installFetch((c) => (c.method === "GET" ? { body: [last] } : { body: "" }));

      const res = await call({ action: "undo", body: {} });
      assert.deepEqual(res.body, { removed: last });
      const [query, del, clock] = fetchMock.calls;
      assert.match(query.url, /mock_draft_picks\?select=.*order=overall_pick\.desc&limit=1$/);
      assert.equal(del.method, "DELETE");
      assert.match(del.url, /mock_draft_picks\?overall_pick=eq\.7$/);
      assert.equal(clock.method, "PATCH");
    });

    test("does nothing on an empty mock board", async () => {
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
});
