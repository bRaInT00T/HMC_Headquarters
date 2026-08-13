require("../helpers/env");

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { installFetch } = require("../helpers/fetch-mock");
const mock = require("../../lib/mock");
const { MOCK_PICKS, MOCK_STATE, readMockState, restartMockClock, clearMockPicks } = mock;

describe("lib/mock", () => {
  let fetchMock = null;
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
  });

  test("only ever names the mock tables", () => {
    // The safety property the whole unauthenticated /api/mock/* surface rests
    // on: nothing in here may touch the real board.
    const source = require("node:fs").readFileSync(require.resolve("../../lib/mock"), "utf8");
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /(?<!mock_)draft_picks|(?<!mock_)draft_config/,
      "lib/mock.js must not name the live tables"
    );
    assert.equal(MOCK_PICKS, "mock_draft_picks");
    assert.equal(MOCK_STATE, "mock_draft_state?id=eq.1");
  });

  test("readMockState returns the stored row", async () => {
    fetchMock = installFetch(() => ({ body: [{ active: true, clock_state: { startedAt: "x" } }] }));
    assert.deepEqual(await readMockState(), { active: true, clock_state: { startedAt: "x" } });
    assert.match(fetchMock.calls[0].url, /mock_draft_state\?id=eq\.1&select=\*$/);
  });

  test("readMockState falls back to an inactive state when the table is empty", async () => {
    fetchMock = installFetch(() => ({ body: [] }));
    assert.deepEqual(await readMockState(), { active: false, clock_state: {} });
  });

  test("readMockState falls back when the table doesn't exist yet", async () => {
    // An un-migrated project answers null here; the public board depends on
    // this failing soft rather than throwing.
    fetchMock = installFetch(() => ({ body: "" }));
    assert.deepEqual(await readMockState(), { active: false, clock_state: {} });
  });

  test("restartMockClock patches a fresh, unpaused countdown", async () => {
    fetchMock = installFetch(() => ({ body: "" }));
    const before = Date.now();
    await restartMockClock();
    const [call] = fetchMock.calls;

    assert.equal(call.method, "PATCH");
    assert.match(call.url, /mock_draft_state\?id=eq\.1$/);
    assert.equal(call.body.clock_state.pausedAt, null);
    const startedMs = new Date(call.body.clock_state.startedAt).getTime();
    assert.ok(startedMs >= before && startedMs <= Date.now());
    assert.ok(call.body.updated_at, "updated_at is what drives the realtime nudge");
  });

  test("clearMockPicks deletes with an explicit filter (PostgREST refuses a bare DELETE)", async () => {
    fetchMock = installFetch(() => ({ body: "" }));
    await clearMockPicks();
    const [call] = fetchMock.calls;
    assert.equal(call.method, "DELETE");
    assert.match(call.url, /mock_draft_picks\?overall_pick=gte\.0$/);
  });
});
