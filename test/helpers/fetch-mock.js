// A stand-in for global fetch. Everything server-side in this repo talks to
// the outside world through fetch (Supabase PostgREST, Yahoo, balldontlie), so
// swapping it out is the whole seam — no module mocking, and lib/supabase.js
// gets exercised for real on the way through.

// Enough of the Response interface for the callers here: ok/status/text()/
// json() plus headers.get() (sync-page reads retry-after).
function makeResponse({ status = 200, body = "", headers = {} } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const lowered = {};
  for (const [k, v] of Object.entries(headers)) lowered[String(k).toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lowered[String(name).toLowerCase()] ?? null },
    async text() {
      return text;
    },
    async json() {
      return text ? JSON.parse(text) : null;
    }
  };
}

// `handler` receives { url, method, headers, body } and returns a response
// spec ({ status, body, headers }), a thrown error, or undefined for a plain
// 200 with an empty body. Returns the recorded calls plus a restore().
function installFetch(handler = () => ({})) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const call = {
      url: String(input),
      method: init.method || "GET",
      headers: init.headers || {},
      rawBody: init.body,
      get body() {
        try {
          return JSON.parse(init.body);
        } catch {
          return undefined;
        }
      }
    };
    calls.push(call);
    return makeResponse((await handler(call, calls.length - 1)) || {});
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

// The common shape: answer each fetch from a list, in order. Handy when a
// handler makes several calls and only the sequence matters.
function replyInOrder(specs) {
  let i = 0;
  return () => specs[i++] || {};
}

// Route by substring of the URL. First match wins; an unmatched URL is a test
// bug, so it throws rather than quietly returning 200.
function replyByUrl(routes) {
  return (call) => {
    for (const [fragment, spec] of Object.entries(routes)) {
      if (call.url.includes(fragment)) return typeof spec === "function" ? spec(call) : spec;
    }
    throw new Error(`No mock route matched ${call.method} ${call.url}`);
  };
}

module.exports = { makeResponse, installFetch, replyInOrder, replyByUrl };
