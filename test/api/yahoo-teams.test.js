require("../helpers/env");

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch, replyByUrl } = require("../helpers/fetch-mock");
const envelope = require("../helpers/yahoo-envelope");
const handler = require("../../api/yahoo/teams.js");

function call({ method = "POST", admin = true } = {}) {
  const res = makeRes();
  return handler(makeReq({ method, body: {}, admin }), res).then(() => res);
}

const validToken = {
  body: [{ access_token: "at", refresh_token: "rt", expires_at: new Date(Date.now() + 6e5).toISOString() }]
};

describe("api/yahoo/teams", () => {
  let fetchMock = null;
  beforeEach(() => {
    process.env.YAHOO_LEAGUE_KEY = "nfl.l.1";
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

  test("returns a name and a joined manager list per team", async () => {
    fetchMock = installFetch(
      replyByUrl({
        yahoo_tokens: validToken,
        fantasysports: {
          body: envelope.teams([
            {
              team_key: "nfl.l.1.t.1",
              name: "Handsome Devils",
              managers: [{ manager: { nickname: "Nick" } }, { manager: { nickname: "Sam" } }]
            },
            { team_key: "nfl.l.1.t.2", name: "Solo Act", managers: [{ manager: { nickname: "Pat" } }] }
          ])
        }
      })
    );

    const res = await call({});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      teams: [
        { name: "Handsome Devils", manager: "Nick & Sam" },
        { name: "Solo Act", manager: "Pat" }
      ]
    });
    assert.ok(fetchMock.calls.some((c) => c.url.includes("/league/nfl.l.1/teams?format=json")));
  });

  test("copes with a team that has no name or no usable managers", async () => {
    fetchMock = installFetch(
      replyByUrl({
        yahoo_tokens: validToken,
        fantasysports: {
          body: envelope.teams([
            { team_key: "nfl.l.1.t.3" },
            { team_key: "nfl.l.1.t.4", name: "Unmanaged", managers: [{}, { manager: {} }] }
          ])
        }
      })
    );

    const res = await call({});
    assert.deepEqual(res.body, {
      teams: [
        { name: "", manager: "" },
        { name: "Unmanaged", manager: "" }
      ]
    });
  });

  test("copes with a team node Yahoo sent as an empty record", async () => {
    fetchMock = installFetch(
      replyByUrl({
        yahoo_tokens: validToken,
        fantasysports: { body: { fantasy_content: { league: [{}, { teams: { 0: { team: [] }, count: 1 } }] } } }
      })
    );

    const res = await call({});
    assert.deepEqual(res.body, { teams: [{ name: "", manager: "" }] });
  });

  test("500s when Yahoo rejects the call", async () => {
    fetchMock = installFetch(
      replyByUrl({ yahoo_tokens: validToken, fantasysports: { status: 500, body: "yahoo is down" } })
    );
    const res = await call({});
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /yahoo is down/);
  });
});
