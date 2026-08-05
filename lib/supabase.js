// Thin REST wrapper around Supabase's PostgREST API, used only from
// server-side Vercel functions (never shipped to the browser). Always uses
// the service role key, which bypasses Row Level Security — that's why
// these functions must never be called without the admin password check.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(pathAndQuery, { method = "GET", body, headers = {} } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in this project's environment variables.");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${method} ${pathAndQuery} failed: ${res.status} ${text}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = { supabaseRequest };
