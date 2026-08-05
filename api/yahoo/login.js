// GET /api/yahoo/login — redirects the browser into Yahoo's OAuth consent
// screen. Link to this from admin.html; Yahoo redirects back to
// /api/yahoo/callback with a ?code= when the commissioner approves access.
module.exports = (req, res) => {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const redirectUri = process.env.YAHOO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).send("YAHOO_CLIENT_ID / YAHOO_REDIRECT_URI are not set in this project's environment variables.");
    return;
  }
  const url =
    `https://api.login.yahoo.com/oauth2/request_auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&language=en-us`;
  res.writeHead(302, { Location: url });
  res.end();
};
