require("../helpers/env");

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { installFetch, replyByUrl } = require("../helpers/fetch-mock");
const handler = require("../../api/players/sync-page.js");

function call({ body, method = "POST", admin = true } = {}) {
  const res = makeRes();
  return handler(makeReq({ method, body, admin }), res).then(() => res);
}

const player = (over = {}) => ({
  id: 1,
  first_name: "Ja'Marr",
  last_name: "Chase",
  position_abbreviation: "WR",
  jersey_number: "1",
  team: { abbreviation: "CIN" },
  ...over
});

describe("api/players/sync-page", () => {
  let fetchMock = null;
  beforeEach(() => {
    process.env.BALLDONTLIE_API_KEY = "bdl-key";
  });
  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
    delete process.env.BALLDONTLIE_API_KEY;
  });

  test("405s on anything but POST", async () => {
    fetchMock = installFetch();
    const res = await call({ method: "GET" });
    assert.equal(res.statusCode, 405);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("401s without the admin password", async () => {
    fetchMock = installFetch();
    const res = await call({ admin: false, body: {} });
    assert.equal(res.statusCode, 401);
  });

  test("500s when the balldontlie key isn't configured", async () => {
    delete process.env.BALLDONTLIE_API_KEY;
    fetchMock = installFetch();
    const res = await call({ body: {} });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /BALLDONTLIE_API_KEY is not set/);
    assert.equal(fetchMock.calls.length, 0);
  });

  test("maps a page of players onto nfl_players rows", async () => {
    fetchMock = installFetch(
      replyByUrl({
        "balldontlie.io": {
          body: {
            data: [player(), player({ id: 2, first_name: "Josh", last_name: "Allen", position_abbreviation: "QB", team: { abbreviation: "BUF" } })],
            meta: { next_cursor: 25 }
          }
        },
        nfl_players: { body: "" }
      })
    );

    const res = await call({ body: {} });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { synced: 2, nextCursor: 25 });

    const apiCall = fetchMock.calls[0];
    assert.equal(apiCall.headers.Authorization, "bdl-key");
    assert.ok(apiCall.url.includes("per_page=100"));
    assert.ok(!apiCall.url.includes("cursor="), "no cursor on the first page");

    const upsert = fetchMock.calls[1];
    assert.equal(upsert.headers.Prefer, "resolution=merge-duplicates");
    const [row] = upsert.body;
    assert.equal(row.id, 1);
    assert.equal(row.full_name, "Ja'Marr Chase");
    assert.equal(row.position, "WR");
    assert.equal(row.team, "CIN");
    assert.equal(row.jersey_number, "1");
    assert.ok(row.updated_at);
  });

  test("passes the cursor through on later pages", async () => {
    fetchMock = installFetch(
      replyByUrl({ "balldontlie.io": { body: { data: [], meta: { next_cursor: null } } } })
    );
    await call({ body: { cursor: 125 } });
    assert.ok(fetchMock.calls[0].url.includes("cursor=125"));
  });

  test("skips unsigned/retired players, who come back with no team", async () => {
    fetchMock = installFetch(
      replyByUrl({
        "balldontlie.io": {
          body: {
            data: [player({ id: 3, team: null }), player({ id: 4, team: {} }), player()],
            meta: {}
          }
        },
        nfl_players: { body: "" }
      })
    );

    const res = await call({ body: {} });
    assert.deepEqual(res.body, { synced: 1, nextCursor: null });
    assert.equal(fetchMock.calls[1].body.length, 1);
  });

  test("falls back through position_abbreviation → position → empty", async () => {
    fetchMock = installFetch(
      replyByUrl({
        "balldontlie.io": {
          body: {
            data: [
              player({ id: 5, position_abbreviation: undefined, position: "Tight End" }),
              player({ id: 6, position_abbreviation: undefined, position: undefined, jersey_number: undefined })
            ],
            meta: { next_cursor: 1 }
          }
        },
        nfl_players: { body: "" }
      })
    );

    await call({ body: {} });
    const rows = fetchMock.calls[1].body;
    assert.equal(rows[0].position, "Tight End");
    assert.equal(rows[1].position, "");
    assert.equal(rows[1].jersey_number, "");
  });

  test("doesn't write anything when the page holds no rostered players", async () => {
    fetchMock = installFetch(replyByUrl({ "balldontlie.io": { body: { meta: { next_cursor: null } } } }));
    const res = await call({ body: {} });

    assert.deepEqual(res.body, { synced: 0, nextCursor: null });
    assert.equal(fetchMock.calls.length, 1, "an empty page must not POST to Supabase");
  });

  test("reports the rate limit as a 429 with the retry-after balldontlie sent", async () => {
    fetchMock = installFetch(
      replyByUrl({
        "balldontlie.io": { status: 429, body: "Too Many Requests", headers: { "retry-after": "13" } }
      })
    );

    const res = await call({ body: {} });
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.retryAfterSeconds, 13);
    assert.match(res.body.error, /balldontlie API failed: 429/);
  });

  test("still 429s when no retry-after header came back", async () => {
    fetchMock = installFetch(replyByUrl({ "balldontlie.io": { status: 429, body: "slow down" } }));
    const res = await call({ body: {} });
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.retryAfterSeconds, null);
  });

  test("any other upstream failure is a 500", async () => {
    fetchMock = installFetch(replyByUrl({ "balldontlie.io": { status: 401, body: "bad key" } }));
    const res = await call({ body: {} });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.retryAfterSeconds, undefined);
    assert.match(res.body.error, /401 bad key/);
  });

  test("a failed Supabase upsert is a 500", async () => {
    fetchMock = installFetch(
      replyByUrl({
        "balldontlie.io": { body: { data: [player()], meta: {} } },
        nfl_players: { status: 500, body: "insert failed" }
      })
    );
    const res = await call({ body: {} });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /insert failed/);
  });

  test("tolerates a missing body", async () => {
    fetchMock = installFetch(replyByUrl({ "balldontlie.io": { body: { data: [], meta: null } } }));
    const res = await call({});
    assert.deepEqual(res.body, { synced: 0, nextCursor: null });
  });
});
