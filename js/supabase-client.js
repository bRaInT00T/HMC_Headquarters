// Requires the Supabase UMD build to be loaded first, e.g.:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
function getSupabaseClient() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.SITE_CONFIG || {};
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!window.supabase || !window.supabase.createClient) return null;
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function adminHeaders() {
  const pw = localStorage.getItem("hmc_admin_password") || "";
  // fetch's Headers only accepts ISO-8859-1 in header values — fail with a
  // clear message here instead of a cryptic error from fetch() itself.
  if (/[^\x00-\xFF]/.test(pw)) {
    throw new Error("Stored admin password contains a non-ASCII/Latin-1 character — re-enter it on the login screen.");
  }
  return { "Content-Type": "application/json", "x-admin-password": pw };
}

async function callAdminApi(path, body) {
  const res = await fetch(path, { method: "POST", headers: adminHeaders(), body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `${path} failed: ${res.status}`);
    if (res.status === 429) err.retryAfterSeconds = json.retryAfterSeconds;
    throw err;
  }
  return json;
}
