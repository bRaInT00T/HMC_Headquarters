// POST /api/picks/remove — deletes one specific pick by its overall number.
// Undo only ever removes the last live pick, which is the right tool during the
// draft; this is the one for pre-draft corrections, mainly pulling a keeper back
// off the board (the rules allow dropping a keeper for injury, suspension or
// holdout in exchange for the coinciding round pick).
// Body: { overallPick }.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const overallPick = Number((req.body || {}).overallPick);
    if (!Number.isInteger(overallPick) || overallPick < 1) {
      res.status(400).json({ error: "overallPick must be a positive integer." });
      return;
    }

    const rows = await supabaseRequest(
      `draft_picks?select=overall_pick,team,player,source&overall_pick=eq.${overallPick}`
    );
    if (!rows || rows.length === 0) {
      res.status(200).json({ removed: null });
      return;
    }

    await supabaseRequest(`draft_picks?overall_pick=eq.${overallPick}`, { method: "DELETE" });
    res.status(200).json({ removed: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
