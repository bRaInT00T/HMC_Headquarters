// Shared admin-password check for every write-capable API route. The
// commissioner's password (entered once on admin.html and cached in the
// browser) is sent as the x-admin-password header on every protected call
// and checked here against the ADMIN_PASSWORD env var — this is now real
// server-side auth, not just a UI deterrent.

function requireAdmin(req, res) {
  const provided = req.headers["x-admin-password"];
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "ADMIN_PASSWORD is not set in this project's environment variables." });
    return false;
  }
  if (provided !== expected) {
    res.status(401).json({ error: "Unauthorized — wrong or missing admin password." });
    return false;
  }
  return true;
}

module.exports = { requireAdmin };
