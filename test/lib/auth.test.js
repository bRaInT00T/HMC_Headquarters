const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { makeReq, makeRes } = require("../helpers/http");
const { requireAdmin } = require("../../lib/auth");

describe("lib/auth requireAdmin", () => {
  const original = process.env.ADMIN_PASSWORD;
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "hunter2";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = original;
  });

  test("passes when the header matches ADMIN_PASSWORD", () => {
    const res = makeRes();
    assert.equal(requireAdmin(makeReq({ headers: { "x-admin-password": "hunter2" } }), res), true);
    assert.equal(res.statusCode, null, "a passing check must not answer the request");
  });

  test("500s when ADMIN_PASSWORD is not configured at all", () => {
    delete process.env.ADMIN_PASSWORD;
    const res = makeRes();
    assert.equal(requireAdmin(makeReq({ headers: { "x-admin-password": "anything" } }), res), false);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /ADMIN_PASSWORD is not set/);
  });

  test("500s on an empty ADMIN_PASSWORD rather than accepting an empty header", () => {
    process.env.ADMIN_PASSWORD = "";
    const res = makeRes();
    assert.equal(requireAdmin(makeReq({ headers: { "x-admin-password": "" } }), res), false);
    assert.equal(res.statusCode, 500);
  });

  test("401s on the wrong password", () => {
    const res = makeRes();
    assert.equal(requireAdmin(makeReq({ headers: { "x-admin-password": "nope" } }), res), false);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /Unauthorized/);
  });

  test("401s when the header is missing entirely", () => {
    const res = makeRes();
    assert.equal(requireAdmin(makeReq({ admin: false }), res), false);
    assert.equal(res.statusCode, 401);
  });
});
