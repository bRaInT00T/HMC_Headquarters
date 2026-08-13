const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const handler = require("../../api/yahoo/login.js");

describe("api/yahoo/login", () => {
  beforeEach(() => {
    process.env.YAHOO_CLIENT_ID = "client id/with chars";
    process.env.YAHOO_REDIRECT_URI = "https://example.test/api/yahoo/callback";
  });
  afterEach(() => {
    delete process.env.YAHOO_CLIENT_ID;
    delete process.env.YAHOO_REDIRECT_URI;
  });

  test("redirects into Yahoo's consent screen with both params encoded", () => {
    const res = makeRes();
    handler(makeReq({ method: "GET" }), res);

    assert.equal(res.statusCode, 302);
    const location = res.redirectHeaders.Location;
    const url = new URL(location);
    assert.equal(url.origin + url.pathname, "https://api.login.yahoo.com/oauth2/request_auth");
    assert.equal(url.searchParams.get("client_id"), "client id/with chars");
    assert.equal(url.searchParams.get("redirect_uri"), "https://example.test/api/yahoo/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(res.ended, true);
  });

  test("500s when the client id isn't configured", () => {
    delete process.env.YAHOO_CLIENT_ID;
    const res = makeRes();
    handler(makeReq({ method: "GET" }), res);

    assert.equal(res.statusCode, 500);
    assert.match(res.text, /YAHOO_CLIENT_ID \/ YAHOO_REDIRECT_URI are not set/);
    assert.equal(res.ended, false);
  });

  test("500s when the redirect uri isn't configured", () => {
    delete process.env.YAHOO_REDIRECT_URI;
    const res = makeRes();
    handler(makeReq({ method: "GET" }), res);
    assert.equal(res.statusCode, 500);
  });
});
