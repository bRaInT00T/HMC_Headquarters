// TEMPORARY DIAGNOSTIC — POST /api/yahoo/whoami
// Returns the real, full Yahoo league key(s) for the connected account's
// current NFL leagues (e.g. "461.l.710518"). Exists only to work around
// YAHOO_LEAGUE_KEY being set to a bare league ID instead of the full
// "{game_key}.l.{league_id}" key Yahoo's API requires (see README.md's
// Yahoo Developer app step) — delete this file once you've read off the
// correct value and fixed YAHOO_LEAGUE_KEY in Vercel.
const { yahooFetch, flattenYahooCollection } = require("../../lib/yahoo");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const json = await yahooFetch("/users;use_login=1/games;game_keys=nfl/leagues");
    const users = flattenYahooCollection(json.fantasy_content.users);
    const leagues = [];
    users.forEach((u) => {
      const games = flattenYahooCollection(u.user[1].games);
      games.forEach((g) => {
        const leagueNodes = flattenYahooCollection(g.game[1].leagues);
        leagueNodes.forEach((l) => {
          leagues.push({ league_key: l.league[0].league_key, name: l.league[0].name });
        });
      });
    });
    res.status(200).json({ leagues });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
