// POST /api/picks/undo — removes the last pick actually made during the draft.
// Keepers are excluded: they're written in before draft day, often in late
// rounds, so "highest overall_pick" on its own would delete someone's round-16
// keeper instead of the pick that was just entered. Also a commit-equivalent:
// the deletion itself is just a normal Supabase write, visible to anyone
// watching draft.html in real time.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const rows = await supabaseRequest(
      "draft_picks?select=overall_pick,team,player&source=neq.keeper&order=overall_pick.desc&limit=1"
    );
    if (!rows || rows.length === 0) {
      res.status(200).json({ removed: null });
      return;
    }
    const last = rows[0];
    await supabaseRequest(`draft_picks?overall_pick=eq.${last.overall_pick}`, { method: "DELETE" });
    // Undo puts that team back on the clock, so give them a fresh two minutes
    // rather than leaving the previous pick's countdown running.
    await supabaseRequest("draft_config?id=eq.1", {
      method: "PATCH",
      body: { clock_state: { startedAt: new Date().toISOString(), pausedAt: null } }
    });
    res.status(200).json({ removed: last });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
