// POST /api/yahoo/teams — returns { name, manager } for every team in the
// league, used by admin.html to populate the draft-order dropdowns instead
// of hand-typing owner names. Same envelope-flattening pattern as
// api/yahoo/sync.js (see that file's comment re: Yahoo's unusual JSON
// shape) — not yet run against a live league (Fantasy API access is
// pending Yahoo's approval as of this writing), so if it errors here
// first, check Vercel function logs for the raw Yahoo response.
const { yahooFetch, flattenYahooCollection } = require("../../lib/yahoo");
const { requireAdmin } = require("../../lib/auth");

function flattenFieldArray(arr) {
  return Object.assign({}, ...(arr || []).filter(Boolean));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const leagueKey = process.env.YAHOO_LEAGUE_KEY;
  if (!leagueKey) {
    res.status(500).json({ error: "YAHOO_LEAGUE_KEY is not set in this project's environment variables." });
    return;
  }

  try {
    const teamsJson = await yahooFetch(`/league/${leagueKey}/teams`);
    const teamNodes = flattenYahooCollection(teamsJson.fantasy_content.league[1].teams).map((t) =>
      flattenFieldArray(t.team[0])
    );

    const teams = teamNodes.map((fields) => {
      const managers = (fields.managers || [])
        .map((m) => m.manager && m.manager.nickname)
        .filter(Boolean);
      return { name: fields.name || "", manager: managers.join(" & ") };
    });

    res.status(200).json({ teams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
