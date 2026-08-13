require("../helpers/env");

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch } = require("../helpers/fetch-mock");
const handler = require("../../api/draft-config/save.js");

function call({ body, method = "POST", admin = true } = {}) {
  const res = makeRes();
  return handler(makeReq({ method, body, admin }), res).then(() => res);
}

describe("api/draft-config/save", () => {
  let fetchMock = null;
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
  });

  test("405s on anything but POST", async () => {
    fetchMock = installFetch();
    const res = await call({ method: "GET" });
    assert.equal(res.statusCode, 405);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("401s without the admin password", async () => {
    fetchMock = installFetch();
    const res = await call({ admin: false, body: { rounds: 15 } });
    assert.equal(res.statusCode, 401);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("400s when there is nothing to update", async () => {
    fetchMock = installFetch();
    for (const body of [undefined, {}, { rounds: 0 }]) {
      const res = await call({ body });
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { error: "Nothing to update." });
    }
    assert.equal(fetchMock.calls.length, 0);
  });

  test("patches the singleton row with the simple scalar fields", async () => {
    fetchMock = installFetch(() => ({ body: "" }));
    const res = await call({
      body: {
        teams: [{ slot: 1, owner: "Nick" }],
        rounds: 16,
        season: 2026,
        draftDate: "August 24, 2026 at 7:00 PM",
        format: "Snake"
      }
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    const [call1] = fetchMock.calls;
    assert.match(call1.url, /draft_config\?id=eq\.1$/);
    assert.equal(call1.method, "PATCH");
    assert.deepEqual(call1.body, {
      teams: [{ slot: 1, owner: "Nick" }],
      rounds: 16,
      season: 2026,
      draft_date: "August 24, 2026 at 7:00 PM",
      format: "Snake"
    });
  });

  test("500s when the patch fails", async () => {
    fetchMock = installFetch(() => ({ status: 500, body: "nope" }));
    const res = await call({ body: { rounds: 16 } });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /nope/);
  });

  describe("draftMode", () => {
    test("accepts each of the three modes", async () => {
      for (const draftMode of ["live", "mock", "testing"]) {
        fetchMock = installFetch(() => ({ body: "" }));
        const res = await call({ body: { draftMode } });
        assert.equal(res.statusCode, 200);
        assert.deepEqual(fetchMock.calls[0].body, { draft_mode: draftMode });
        fetchMock.restore();
        fetchMock = null;
      }
    });

    test("rejects anything else with a readable message", async () => {
      fetchMock = installFetch();
      const res = await call({ body: { draftMode: "chaos" } });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /draftMode must be one of: live, mock, testing\./);
      assert.equal(fetchMock.calls.length, 0);
    });
  });

  describe("positionColors", () => {
    test("normalises valid hex values to lower case", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ body: { positionColors: { qb: "  #E08B3A  ", def: "#5A6172" } } });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(fetchMock.calls[0].body, { position_colors: { qb: "#e08b3a", def: "#5a6172" } });
    });

    test("accepts an empty object as 'back to the stylesheet defaults'", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ body: { positionColors: {} } });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(fetchMock.calls[0].body, { position_colors: {} });
    });

    test("rejects a non-object, null, or array", async () => {
      fetchMock = installFetch();
      for (const positionColors of [null, "#fff", 7, ["#ffffff"]]) {
        const res = await call({ body: { positionColors } });
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: "positionColors must be an object." });
      }
      assert.equal(fetchMock.calls.length, 0);
    });

    test("rejects an unknown position group", async () => {
      fetchMock = installFetch();
      const res = await call({ body: { positionColors: { punter: "#ffffff" } } });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /Unknown position group "punter"/);
    });

    test("rejects anything that isn't a six-digit hex — these reach a style property", async () => {
      fetchMock = installFetch();
      for (const value of ["red", "#fff", "#ffffffff", "#12345g", 16777215, null, "url(evil)"]) {
        const res = await call({ body: { positionColors: { qb: value } } });
        assert.equal(res.statusCode, 400, `expected 400 for ${String(value)}`);
        assert.match(res.body.error, /must be a hex value/);
      }
      assert.equal(fetchMock.calls.length, 0);
    });
  });

  describe("tradedPicks", () => {
    test("coerces the legs to numbers and drops incomplete ones", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({
        body: {
          tradedPicks: [
            { round: "3", fromSlot: "5", toSlot: "2" },
            null,
            { round: 4, fromSlot: 1 },
            { fromSlot: 1, toSlot: 2 },
            { round: 5, toSlot: 2 }
          ]
        }
      });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(fetchMock.calls[0].body, {
        traded_picks: [{ round: 3, fromSlot: 5, toSlot: 2 }]
      });
    });

    test("marks a commissioner override but leaves ordinary legs untouched", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      await call({
        body: {
          tradedPicks: [
            { round: 1, fromSlot: 2, toSlot: 3, override: true },
            { round: 2, fromSlot: 3, toSlot: 4, override: false }
          ]
        }
      });

      assert.deepEqual(fetchMock.calls[0].body.traded_picks, [
        { round: 1, fromSlot: 2, toSlot: 3, override: true },
        { round: 2, fromSlot: 3, toSlot: 4 }
      ]);
    });

    test("an empty array means 'no trades', not 'nothing to update'", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ body: { tradedPicks: [] } });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(fetchMock.calls[0].body, { traded_picks: [] });
    });

    test("a non-array tradedPicks is ignored rather than stored", async () => {
      fetchMock = installFetch();
      const res = await call({ body: { tradedPicks: "none" } });
      assert.equal(res.statusCode, 400, "ignoring it leaves an empty patch");
    });
  });
});
