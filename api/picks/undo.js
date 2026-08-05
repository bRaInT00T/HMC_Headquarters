// POST /api/picks/undo — removes the highest overall_pick row. Also a
// commit-equivalent: the deletion itself is just a normal Supabase write,
// visible to anyone watching draft.html in real time.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const rows = await supabaseRequest("draft_picks?select=overall_pick,team,player&order=overall_pick.desc&limit=1");
    if (!rows || rows.length === 0) {
      res.status(200).json({ removed: null });
      return;
    }
    const last = rows[0];
    await supabaseRequest(`draft_picks?overall_pick=eq.${last.overall_pick}`, { method: "DELETE" });
    res.status(200).json({ removed: last });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
