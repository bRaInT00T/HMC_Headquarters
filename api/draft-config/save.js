// POST /api/draft-config/save — updates the singleton draft_config row
// (owner-per-slot draft order, rounds, format, date). Body may include any
// subset of { teams, rounds, season, draftDate, format }.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const { teams, rounds, season, draftDate, format } = req.body || {};
    const patch = {};
    if (teams) patch.teams = teams;
    if (rounds) patch.rounds = rounds;
    if (season) patch.season = season;
    if (draftDate) patch.draft_date = draftDate;
    if (format) patch.format = format;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }

    await supabaseRequest("draft_config?id=eq.1", { method: "PATCH", body: patch });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
