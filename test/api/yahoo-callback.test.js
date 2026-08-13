require("../helpers/env");

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch, replyByUrl } = require("../helpers/fetch-mock");
const handler = require("../../api/yahoo/callback.js");

function call(query) {
  const res = makeRes();
  return handler(makeReq({ method: "GET", query }), res).then(() => res);
}

describe("api/yahoo/callback", () => {
  let fetchMock = null;
  beforeEach(() => {
    process.env.YAHOO_CLIENT_ID = "client-id";
    process.env.YAHOO_CLIENT_SECRET = "client-secret";
    process.env.YAHOO_REDIRECT_URI = "https://example.test/api/yahoo/callback";
  });
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
    delete process.env.YAHOO_CLIENT_ID;
    delete process.env.YAHOO_CLIENT_SECRET;
    delete process.env.YAHOO_REDIRECT_URI;
  });

  test("stores the tokens and bounces back to admin.html", async () => {
    fetchMock = installFetch(
      replyByUrl({
        get_token: { body: { access_token: "at", refresh_token: "rt", expires_in: 3600 } },
        yahoo_tokens: { body: "" }
      })
    );

    const res = await call({ code: "the-code" });
    assert.equal(res.statusCode, 302);
    assert.deepEqual(res.redirectHeaders, { Location: "/admin.html?yahoo=connected" });
    assert.equal(res.ended, true);

    const save = fetchMock.calls.find((c) => c.url.includes("yahoo_tokens"));
    assert.equal(save.body[0].access_token, "at");
  });

  test("400s when Yahoo reports an authorization error", async () => {
    fetchMock = installFetch();
    const res = await call({ error: "access_denied" });
    assert.equal(res.statusCode, 400);
    assert.match(res.text, /Yahoo returned an error during authorization: access_denied/);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("400s when the code is missing", async () => {
    fetchMock = installFetch();
    const res = await call({});
    assert.equal(res.statusCode, 400);
    assert.match(res.text, /Missing \?code/);
  });

  test("400s when there is no query string at all", async () => {
    fetchMock = installFetch();
    const res = makeRes();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 400);
  });

  test("500s with the reason when the exchange fails", async () => {
    fetchMock = installFetch(replyByUrl({ get_token: { status: 400, body: "invalid_grant" } }));
    const res = await call({ code: "stale" });
    assert.equal(res.statusCode, 500);
    assert.match(res.text, /Yahoo token exchange failed: 400 invalid_grant/);
  });
});
