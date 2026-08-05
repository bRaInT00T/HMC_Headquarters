// Yahoo Fantasy Sports OAuth 2.0 + API helpers, server-side only.
// Docs: https://developer.yahoo.com/fantasysports/guide/

const { supabaseRequest } = require("./supabase");

const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const YAHOO_FANTASY_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

function basicAuthHeader() {
  const id = process.env.YAHOO_CLIENT_ID;
  const secret = process.env.YAHOO_CLIENT_SECRET;
  if (!id || !secret) throw new Error("YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET not set.");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: process.env.YAHOO_REDIRECT_URI,
    code
  });
  const res = await fetch(YAHOO_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`Yahoo token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshTokens(refreshToken) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    redirect_uri: process.env.YAHOO_REDIRECT_URI,
    refresh_token: refreshToken
  });
  const res = await fetch(YAHOO_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuthHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`Yahoo token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function saveTokens(tokenResponse) {
  const row = { id: 1, access_token: tokenResponse.access_token };
  if (tokenResponse.refresh_token) row.refresh_token = tokenResponse.refresh_token;
  if (tokenResponse.expires_in) {
    row.expires_at = new Date(Date.now() + (tokenResponse.expires_in - 60) * 1000).toISOString();
  }
  await supabaseRequest("yahoo_tokens", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: [row]
  });
}

async function getValidAccessToken() {
  const rows = await supabaseRequest("yahoo_tokens?id=eq.1&select=*");
  const row = rows && rows[0];
  if (!row || !row.refresh_token) {
    throw new Error("Yahoo isn't connected yet — visit /api/yahoo/login first (from admin.html).");
  }
  if (row.access_token && row.expires_at && new Date(row.expires_at) > new Date()) {
    return row.access_token;
  }
  const refreshed = await refreshTokens(row.refresh_token);
  await saveTokens(refreshed);
  return refreshed.access_token;
}

async function yahooFetch(path) {
  const token = await getValidAccessToken();
  const url = `${YAHOO_FANTASY_BASE}${path}${path.includes("?") ? "&" : "?"}format=json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Yahoo API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Yahoo's Fantasy API wraps collections in an object whose keys are
// stringified indices ("0", "1", ...) plus a trailing "count" key, instead
// of a plain array. This flattens that shape. If Yahoo changes their
// envelope format, this is the one place to fix it.
function flattenYahooCollection(node) {
  if (!node) return [];
  return Object.keys(node)
    .filter((k) => k !== "count")
    .map((k) => node[k]);
}

module.exports = { exchangeCodeForTokens, saveTokens, getValidAccessToken, yahooFetch, flattenYahooCollection };
