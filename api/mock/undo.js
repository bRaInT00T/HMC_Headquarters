// POST /api/mock/undo — removes the last pick of the rehearsal draft. No
// keeper handling, unlike api/picks/undo.js: a mock board starts empty, so the
// highest overall_pick is always the pick that was just made. Deliberately
// unauthenticated (see lib/mock.js).
const { supabaseRequest } = require("../../lib/supabase");
const { MOCK_PICKS, restartMockClock } = require("../../lib/mock");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  try {
    const rows = await supabaseRequest(
      `${MOCK_PICKS}?select=overall_pick,team,player&order=overall_pick.desc&limit=1`
    );
    if (!rows || rows.length === 0) {
      res.status(200).json({ removed: null });
      return;
    }
    const last = rows[0];
    await supabaseRequest(`${MOCK_PICKS}?overall_pick=eq.${last.overall_pick}`, { method: "DELETE" });
    await restartMockClock();
    res.status(200).json({ removed: last });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
