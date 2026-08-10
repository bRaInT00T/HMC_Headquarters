// Helpers shared by the /api/mock/* routes.
//
// These routes are the one place in this project that writes to Supabase
// without an admin-password check: any league member can run a rehearsal draft
// from the public board. That is only safe because every write here is confined
// to mock_draft_state and mock_draft_picks — nothing in this file, or in the
// routes that use it, may name draft_picks or draft_config.
const { supabaseRequest } = require("./supabase");

const MOCK_PICKS = "mock_draft_picks";
const MOCK_STATE = "mock_draft_state?id=eq.1";

async function readMockState() {
  const rows = await supabaseRequest("mock_draft_state?id=eq.1&select=*");
  return (rows && rows[0]) || { active: false, clock_state: {} };
}

// Puts whoever is next on the clock with a fresh countdown. Mirrors what
// api/picks/add.js does to draft_config, but against the mock's own state.
async function restartMockClock() {
  await supabaseRequest(MOCK_STATE, {
    method: "PATCH",
    body: {
      clock_state: { startedAt: new Date().toISOString(), pausedAt: null },
      updated_at: new Date().toISOString()
    }
  });
}

async function clearMockPicks() {
  // PostgREST refuses an unfiltered DELETE, so match every row explicitly.
  await supabaseRequest(`${MOCK_PICKS}?overall_pick=gte.0`, { method: "DELETE" });
}

module.exports = { MOCK_PICKS, MOCK_STATE, readMockState, restartMockClock, clearMockPicks };
