// POST /api/mock/stop — ends the rehearsal and throws the board away. Body:
// { keepPicks } to leave the picks in place for review instead of clearing
// them. Deliberately unauthenticated (see lib/mock.js).
const { supabaseRequest } = require("../../lib/supabase");
const { MOCK_STATE, clearMockPicks } = require("../../lib/mock");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  try {
    const { keepPicks } = req.body || {};
    const now = new Date().toISOString();
    await supabaseRequest(MOCK_STATE, {
      method: "PATCH",
      body: { active: false, clock_state: {}, updated_at: now }
    });
    if (!keepPicks) await clearMockPicks();
    res.status(200).json({ active: false, cleared: !keepPicks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
