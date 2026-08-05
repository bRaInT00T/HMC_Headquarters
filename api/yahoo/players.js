// POST /api/yahoo/players — searches Yahoo's player database for
// autocomplete suggestions in admin.html's manual pick-entry form.
// Read-only, but still admin-gated like every other route that calls
// into Yahoo (see api/yahoo/sync.js for the same pattern).
const { yahooFetch, flattenYahooCollection } = require("../../lib/yahoo");
const { requireAdmin } = require("../../lib/auth");

// Yahoo often represents a "record" as an array of small single-key
// objects, e.g. [{name:"..."}, {display_position:"..."}, ...] — this
// flattens that into one plain object. Duplicated from api/yahoo/sync.js
// rather than shared, matching that file's existing local-helper pattern.
function flattenFieldArray(arr) {
  return Object.assign({}, ...(arr || []).filter(Boolean));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const q = ((req.body && req.body.q) || "").trim();
  if (q.length < 2) {
    res.status(200).json({ players: [] });
    return;
  }

  const leagueKey = process.env.YAHOO_LEAGUE_KEY;
  if (!leagueKey) {
    res.status(500).json({ error: "YAHOO_LEAGUE_KEY is not set in this project's environment variables." });
    return;
  }

  try {
    const playersJson = await yahooFetch(
      `/league/${leagueKey}/players;search=${encodeURIComponent(q)};count=10`
    );
    const playerNodes = flattenYahooCollection(playersJson.fantasy_content.league[1].players).map((p) =>
      flattenFieldArray(p.player[0])
    );
    const players = playerNodes
      .map((fields) => ({
        name: fields.name ? fields.name.full : "",
        position: fields.display_position || "",
        nflTeam: fields.editorial_team_abbr || ""
      }))
      .filter((p) => p.name);

    res.status(200).json({ players });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
