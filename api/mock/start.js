// POST /api/mock/start — begins a rehearsal draft: clears any previous mock
// board and puts slot 1 on the clock. Deliberately unauthenticated (see
// lib/mock.js) — it can only touch the mock tables.
const { supabaseRequest } = require("../../lib/supabase");
const { MOCK_STATE, clearMockPicks } = require("../../lib/mock");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  try {
    // Order matters: clear first, so a viewer who sees active=true never sees
    // the previous run's picks still on the board.
    await clearMockPicks();
    const now = new Date().toISOString();
    await supabaseRequest(MOCK_STATE, {
      method: "PATCH",
      body: {
        active: true,
        started_at: now,
        clock_state: { startedAt: now, pausedAt: null },
        updated_at: now
      }
    });
    res.status(200).json({ active: true, startedAt: now });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
