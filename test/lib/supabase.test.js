require("../helpers/env");

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { installFetch } = require("../helpers/fetch-mock");
const { supabaseRequest } = require("../../lib/supabase");

describe("lib/supabase supabaseRequest", () => {
  let fetchMock = null;
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
  });

  test("GETs by default, with the service role key on both auth headers", async () => {
    fetchMock = installFetch(() => ({ body: [{ id: 1 }] }));
    const result = await supabaseRequest("draft_config?id=eq.1&select=*");

    assert.deepEqual(result, [{ id: 1 }]);
    assert.equal(fetchMock.calls.length, 1);
    const [call] = fetchMock.calls;
    assert.equal(call.url, "https://test.supabase.co/rest/v1/draft_config?id=eq.1&select=*");
    assert.equal(call.method, "GET");
    assert.equal(call.headers.apikey, "test-service-role-key");
    assert.equal(call.headers.Authorization, "Bearer test-service-role-key");
    assert.equal(call.headers["Content-Type"], "application/json");
    assert.equal(call.rawBody, undefined, "a GET must not carry a body");
  });

  test("serializes the body and merges extra headers on a write", async () => {
    fetchMock = installFetch(() => ({ body: "" }));
    await supabaseRequest("draft_picks", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: [{ overall_pick: 1 }]
    });

    const [call] = fetchMock.calls;
    assert.equal(call.method, "POST");
    assert.equal(call.headers.Prefer, "resolution=merge-duplicates");
    assert.deepEqual(call.body, [{ overall_pick: 1 }]);
  });

  test("returns null when PostgREST answers with an empty body", async () => {
    fetchMock = installFetch(() => ({ body: "" }));
    assert.equal(await supabaseRequest("draft_config?id=eq.1", { method: "PATCH", body: {} }), null);
  });

  test("throws with the status and response text when PostgREST rejects the call", async () => {
    fetchMock = installFetch(() => ({ status: 400, body: "duplicate key value" }));
    await assert.rejects(() => supabaseRequest("draft_picks", { method: "POST", body: [] }), {
      message: "Supabase POST draft_picks failed: 400 duplicate key value"
    });
  });

  test("still throws when the error body itself can't be read", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("stream closed");
      }
    });
    try {
      await assert.rejects(() => supabaseRequest("draft_picks"), {
        message: "Supabase GET draft_picks failed: 500 "
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("throws before fetching when the Supabase env vars are missing", async () => {
    const path = require.resolve("../../lib/supabase");
    const cached = require.cache[path];
    delete require.cache[path];
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    fetchMock = installFetch(() => {
      throw new Error("fetch should never be reached");
    });

    try {
      const unconfigured = require("../../lib/supabase");
      await assert.rejects(() => unconfigured.supabaseRequest("draft_config"), {
        message: /SUPABASE_URL \/ SUPABASE_SERVICE_ROLE_KEY are not set/
      });
      assert.equal(fetchMock.calls.length, 0);
    } finally {
      process.env.SUPABASE_URL = url;
      process.env.SUPABASE_SERVICE_ROLE_KEY = key;
      require.cache[path] = cached;
    }
  });
});
