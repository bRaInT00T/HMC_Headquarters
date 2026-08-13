// Stand-ins for the (req, res) pair Vercel hands a serverless function.
// The handlers in api/* only ever touch req.method/query/body/headers and
// res.status().json() / res.send() / res.writeHead() + res.end(), so that is
// all these fake.

const ADMIN_PASSWORD = "test-admin-password";

function makeReq({ method = "POST", body, query = {}, headers = {}, admin = true } = {}) {
  const allHeaders = { ...headers };
  if (admin && allHeaders["x-admin-password"] === undefined) {
    allHeaders["x-admin-password"] = ADMIN_PASSWORD;
  }
  return { method, body, query, headers: allHeaders };
}

// Records what the handler answered. `status` is null until the handler
// answers, which is what the "handler never responded" assertions check.
function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    text: undefined,
    redirectHeaders: null,
    ended: false
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  res.send = (payload) => {
    res.text = payload;
    return res;
  };
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    res.redirectHeaders = headers;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

module.exports = { ADMIN_PASSWORD, makeReq, makeRes };
