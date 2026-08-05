// GET /api/yahoo/callback — Yahoo redirects here with ?code=... after the
// commissioner approves access. Exchanges the code for access/refresh
// tokens and stores them in Supabase (yahoo_tokens table, service-role
// only — never exposed to the browser), then bounces back to admin.html.
const { exchangeCodeForTokens, saveTokens } = require("../../lib/yahoo");

module.exports = async (req, res) => {
  const { code, error } = req.query || {};
  if (error) {
    res.status(400).send(`Yahoo returned an error during authorization: ${error}`);
    return;
  }
  if (!code) {
    res.status(400).send("Missing ?code from Yahoo's callback.");
    return;
  }
  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveTokens(tokens);
    res.writeHead(302, { Location: "/admin.html?yahoo=connected" });
    res.end();
  } catch (e) {
    res.status(500).send("Yahoo token exchange failed: " + e.message);
  }
};
