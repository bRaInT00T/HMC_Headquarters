require("../helpers/env");

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch } = require("../helpers/fetch-mock");
const handler = require("../../api/clock/set.js");

function call({ body, method = "POST", admin = true } = {}) {
  const res = makeRes();
  return handler(makeReq({ method, body, admin }), res).then(() => res);
}

// GET returns the stored clock_state; PATCH just acknowledges.
const stored = (clockState) => (c) => (c.method === "GET" ? { body: [{ clock_state: clockState }] } : { body: "" });

describe("api/clock/set", () => {
  let fetchMock = null;
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
  });

  test("405s on anything but POST", async () => {
    fetchMock = installFetch();
    const res = await call({ method: "GET", body: { action: "pause" } });
    assert.equal(res.statusCode, 405);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("401s without the admin password", async () => {
    fetchMock = installFetch();
    const res = await call({ admin: false, body: { action: "pause" } });
    assert.equal(res.statusCode, 401);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("400s on a missing or unknown action", async () => {
    fetchMock = installFetch();
    for (const body of [undefined, {}, { action: "stop" }]) {
      const res = await call({ body });
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /action must be "pause", "resume", or "reset"/);
    }
    assert.equal(fetchMock.calls.length, 0);
  });

  test("500s when the patch fails", async () => {
    fetchMock = installFetch(() => ({ status: 500, body: "down" }));
    const res = await call({ body: { action: "reset" } });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /down/);
  });

  describe("reset", () => {
    test("starts a fresh running clock", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const before = Date.now();
      const res = await call({ body: { action: "reset" } });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.clockState.pausedAt, null);
      assert.ok(new Date(res.body.clockState.startedAt).getTime() >= before);
      assert.equal(fetchMock.calls.length, 1, "reset needs no read of the current state");
      assert.deepEqual(fetchMock.calls[0].body, { clock_state: res.body.clockState });
    });

    test("pauseAfter parks a full, frozen clock", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const res = await call({ body: { action: "reset", pauseAfter: true } });
      const { startedAt, pausedAt } = res.body.clockState;
      assert.equal(startedAt, pausedAt, "same instant means nothing has ticked off yet");
    });
  });

  describe("pause", () => {
    test("freezes a running clock at now", async () => {
      const startedAt = new Date(Date.now() - 30_000).toISOString();
      fetchMock = installFetch(stored({ startedAt, pausedAt: null }));
      const before = Date.now();
      const res = await call({ body: { action: "pause" } });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.clockState.startedAt, startedAt, "the anchor must not move");
      assert.ok(new Date(res.body.clockState.pausedAt).getTime() >= before);
      assert.equal(fetchMock.calls[1].method, "PATCH");
    });

    test("is a no-op on an already-paused clock, so banked time survives", async () => {
      const current = { startedAt: "2026-08-24T23:00:00.000Z", pausedAt: "2026-08-24T23:00:30.000Z" };
      fetchMock = installFetch(stored(current));
      const res = await call({ body: { action: "pause" } });

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { ok: true, clockState: current, unchanged: true });
      assert.equal(fetchMock.calls.length, 1, "an unchanged clock must not be written back");
    });

    test("anchors to now when nothing was running", async () => {
      fetchMock = installFetch(stored({}));
      const before = Date.now();
      const res = await call({ body: { action: "pause" } });

      const { startedAt, pausedAt } = res.body.clockState;
      assert.ok(new Date(startedAt).getTime() >= before);
      assert.equal(startedAt, pausedAt);
    });

    test("copes with a config row that has never held a clock", async () => {
      fetchMock = installFetch((c) => (c.method === "GET" ? { body: [] } : { body: "" }));
      const res = await call({ body: { action: "pause" } });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.clockState.pausedAt);
    });

    test("copes with a null config response", async () => {
      fetchMock = installFetch((c) => (c.method === "GET" ? { body: "" } : { body: "" }));
      const res = await call({ body: { action: "pause" } });
      assert.equal(res.statusCode, 200);
    });
  });

  describe("resume", () => {
    test("rolls startedAt forward by exactly the pause length", async () => {
      const now = Date.now();
      const startedAt = new Date(now - 90_000).toISOString();
      const pausedAt = new Date(now - 30_000).toISOString();
      fetchMock = installFetch(stored({ startedAt, pausedAt }));

      const res = await call({ body: { action: "resume" } });
      assert.equal(res.body.clockState.pausedAt, null);

      // The pause lasted ~30s, so the anchor should move forward ~30s.
      const moved = new Date(res.body.clockState.startedAt).getTime() - new Date(startedAt).getTime();
      assert.ok(Math.abs(moved - 30_000) < 2_000, `anchor moved ${moved}ms`);
    });

    test("anchors to now when the clock was paused without ever starting", async () => {
      const pausedAt = new Date(Date.now() - 5_000).toISOString();
      fetchMock = installFetch(stored({ pausedAt }));
      const before = Date.now();

      const res = await call({ body: { action: "resume" } });
      // started defaults to now, then rolls forward by the 5s pause.
      const startedMs = new Date(res.body.clockState.startedAt).getTime();
      assert.ok(startedMs >= before + 4_000, "resuming an unanchored clock gives a full countdown");
    });

    test("is a no-op on a clock that isn't paused", async () => {
      const current = { startedAt: "2026-08-24T23:00:00.000Z", pausedAt: null };
      fetchMock = installFetch(stored(current));
      const res = await call({ body: { action: "resume" } });

      assert.deepEqual(res.body, { ok: true, clockState: current, unchanged: true });
      assert.equal(fetchMock.calls.length, 1);
    });
  });
});
