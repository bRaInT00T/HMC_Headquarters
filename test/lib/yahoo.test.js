require("../helpers/env");

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { installFetch, replyByUrl } = require("../helpers/fetch-mock");
const {
  exchangeCodeForTokens,
  saveTokens,
  getValidAccessToken,
  yahooFetch,
  flattenYahooCollection
} = require("../../lib/yahoo");

const TOKEN_URL = "api.login.yahoo.com/oauth2/get_token";
const TOKENS_TABLE = "yahoo_tokens";

describe("lib/yahoo", () => {
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

  describe("flattenYahooCollection", () => {
    test("turns Yahoo's index-keyed envelope into an array, dropping count", () => {
      assert.deepEqual(flattenYahooCollection({ 0: { a: 1 }, 1: { a: 2 }, count: 2 }), [{ a: 1 }, { a: 2 }]);
    });

    test("treats a missing node as an empty collection", () => {
      assert.deepEqual(flattenYahooCollection(undefined), []);
      assert.deepEqual(flattenYahooCollection(null), []);
      assert.deepEqual(flattenYahooCollection({}), []);
    });
  });

  describe("exchangeCodeForTokens", () => {
    test("posts the authorization code with basic auth and returns the tokens", async () => {
      fetchMock = installFetch(() => ({ body: { access_token: "at", refresh_token: "rt", expires_in: 3600 } }));
      const tokens = await exchangeCodeForTokens("the-code");

      assert.deepEqual(tokens, { access_token: "at", refresh_token: "rt", expires_in: 3600 });
      const [call] = fetchMock.calls;
      assert.ok(call.url.includes(TOKEN_URL));
      assert.equal(call.method, "POST");
      assert.equal(
        call.headers.Authorization,
        "Basic " + Buffer.from("client-id:client-secret").toString("base64")
      );
      const params = new URLSearchParams(call.rawBody);
      assert.equal(params.get("grant_type"), "authorization_code");
      assert.equal(params.get("code"), "the-code");
      assert.equal(params.get("redirect_uri"), "https://example.test/api/yahoo/callback");
    });

    test("throws when Yahoo rejects the exchange", async () => {
      fetchMock = installFetch(() => ({ status: 400, body: "invalid_grant" }));
      await assert.rejects(() => exchangeCodeForTokens("bad"), {
        message: "Yahoo token exchange failed: 400 invalid_grant"
      });
    });

    test("throws when the Yahoo client credentials are missing", async () => {
      delete process.env.YAHOO_CLIENT_SECRET;
      fetchMock = installFetch(() => {
        throw new Error("fetch should never be reached");
      });
      await assert.rejects(() => exchangeCodeForTokens("code"), {
        message: "YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET not set."
      });
      assert.equal(fetchMock.calls.length, 0);
    });

    test("throws when only the client id is missing", async () => {
      delete process.env.YAHOO_CLIENT_ID;
      fetchMock = installFetch(() => ({}));
      await assert.rejects(() => exchangeCodeForTokens("code"), /not set/);
    });
  });

  describe("saveTokens", () => {
    test("upserts every field Yahoo sent, expiring a minute early", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      const before = Date.now();
      await saveTokens({ access_token: "at", refresh_token: "rt", expires_in: 3600 });

      const [call] = fetchMock.calls;
      assert.ok(call.url.includes(TOKENS_TABLE));
      assert.equal(call.method, "POST");
      assert.equal(call.headers.Prefer, "resolution=merge-duplicates");
      const [row] = call.body;
      assert.equal(row.id, 1);
      assert.equal(row.access_token, "at");
      assert.equal(row.refresh_token, "rt");
      const expiresMs = new Date(row.expires_at).getTime();
      assert.ok(expiresMs >= before + 3540 * 1000 && expiresMs <= Date.now() + 3540 * 1000);
    });

    test("leaves the stored refresh token alone when a refresh response omits it", async () => {
      // Yahoo only returns refresh_token on the first exchange; overwriting the
      // row with an undefined one would disconnect the league.
      fetchMock = installFetch(() => ({ body: "" }));
      await saveTokens({ access_token: "at-only" });

      const [row] = fetchMock.calls[0].body;
      assert.deepEqual(row, { id: 1, access_token: "at-only" });
    });
  });

  describe("getValidAccessToken", () => {
    test("returns the stored token while it is still valid", async () => {
      const future = new Date(Date.now() + 600 * 1000).toISOString();
      fetchMock = installFetch(() => ({ body: [{ access_token: "still-good", refresh_token: "rt", expires_at: future }] }));

      assert.equal(await getValidAccessToken(), "still-good");
      assert.equal(fetchMock.calls.length, 1, "a valid token must not trigger a refresh");
    });

    test("refreshes and re-saves an expired token", async () => {
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      fetchMock = installFetch(
        replyByUrl({
          "yahoo_tokens?id=eq.1": { body: [{ access_token: "stale", refresh_token: "rt", expires_at: past }] },
          [TOKEN_URL]: { body: { access_token: "fresh", refresh_token: "rt2", expires_in: 3600 } },
          [TOKENS_TABLE]: { body: "" }
        })
      );

      assert.equal(await getValidAccessToken(), "fresh");
      const refreshCall = fetchMock.calls.find((c) => c.url.includes(TOKEN_URL));
      assert.equal(new URLSearchParams(refreshCall.rawBody).get("grant_type"), "refresh_token");
      assert.equal(new URLSearchParams(refreshCall.rawBody).get("refresh_token"), "rt");
      const saveCall = fetchMock.calls.at(-1);
      assert.equal(saveCall.body[0].access_token, "fresh");
    });

    test("refreshes when there is a refresh token but no access token yet", async () => {
      fetchMock = installFetch(
        replyByUrl({
          "yahoo_tokens?id=eq.1": { body: [{ refresh_token: "rt" }] },
          [TOKEN_URL]: { body: { access_token: "fresh" } },
          [TOKENS_TABLE]: { body: "" }
        })
      );
      assert.equal(await getValidAccessToken(), "fresh");
    });

    test("refreshes when the row has an access token but no expiry", async () => {
      fetchMock = installFetch(
        replyByUrl({
          "yahoo_tokens?id=eq.1": { body: [{ access_token: "unknown-age", refresh_token: "rt" }] },
          [TOKEN_URL]: { body: { access_token: "fresh" } },
          [TOKENS_TABLE]: { body: "" }
        })
      );
      assert.equal(await getValidAccessToken(), "fresh");
    });

    test("throws when Yahoo has never been connected", async () => {
      fetchMock = installFetch(() => ({ body: [] }));
      await assert.rejects(() => getValidAccessToken(), /Yahoo isn't connected yet/);
    });

    test("throws when the row exists but has no refresh token", async () => {
      fetchMock = installFetch(() => ({ body: [{ access_token: "orphan" }] }));
      await assert.rejects(() => getValidAccessToken(), /Yahoo isn't connected yet/);
    });

    test("throws when the token table hasn't been created", async () => {
      fetchMock = installFetch(() => ({ body: "" }));
      await assert.rejects(() => getValidAccessToken(), /Yahoo isn't connected yet/);
    });

    test("surfaces a failed refresh", async () => {
      fetchMock = installFetch(
        replyByUrl({
          "yahoo_tokens?id=eq.1": { body: [{ refresh_token: "revoked" }] },
          [TOKEN_URL]: { status: 400, body: "invalid_grant" }
        })
      );
      await assert.rejects(() => getValidAccessToken(), {
        message: "Yahoo token refresh failed: 400 invalid_grant"
      });
    });
  });

  describe("yahooFetch", () => {
    const validRow = () => ({
      body: [{ access_token: "at", refresh_token: "rt", expires_at: new Date(Date.now() + 6e5).toISOString() }]
    });

    test("appends format=json with a ? when the path has no query string", async () => {
      fetchMock = installFetch(
        replyByUrl({ yahoo_tokens: validRow(), fantasysports: { body: { fantasy_content: {} } } })
      );
      assert.deepEqual(await yahooFetch("/league/nfl.l.1/teams"), { fantasy_content: {} });

      const apiCall = fetchMock.calls.find((c) => c.url.includes("fantasysports"));
      assert.equal(
        apiCall.url,
        "https://fantasysports.yahooapis.com/fantasy/v2/league/nfl.l.1/teams?format=json"
      );
      assert.equal(apiCall.headers.Authorization, "Bearer at");
    });

    test("appends format=json with an & when the path already has a query string", async () => {
      fetchMock = installFetch(
        replyByUrl({ yahoo_tokens: validRow(), fantasysports: { body: { fantasy_content: {} } } })
      );
      await yahooFetch("/league/nfl.l.1/players;player_keys=a,b?status=A");

      const apiCall = fetchMock.calls.find((c) => c.url.includes("fantasysports"));
      assert.ok(apiCall.url.endsWith("?status=A&format=json"));
    });

    test("throws with the path, status and body when Yahoo rejects the call", async () => {
      fetchMock = installFetch(
        replyByUrl({ yahoo_tokens: validRow(), fantasysports: { status: 999, body: "boom" } })
      );
      await assert.rejects(() => yahooFetch("/league/x/teams"), {
        message: "Yahoo API /league/x/teams failed: 999 boom"
      });
    });
  });
});
