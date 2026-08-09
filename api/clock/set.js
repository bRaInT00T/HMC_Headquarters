// POST /api/clock/set — pause, resume, or reset the pick clock.
// Body: { action: "pause" | "resume" | "reset" }.
//
// The clock lives in draft_config.clock_state as {startedAt, pausedAt} rather
// than in each browser, so all viewers agree and a reload doesn't restart it.
// Everything is computed from those two server timestamps:
//   running → deadline is startedAt + PICK_CLOCK_SECONDS
//   paused  → whatever was left at pausedAt, frozen
// Resuming rolls startedAt forward by however long the pause lasted, so the
// remaining time picks up exactly where it stopped.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const action = (req.body || {}).action;
    if (!["pause", "resume", "reset"].includes(action)) {
      res.status(400).json({ error: 'action must be "pause", "resume", or "reset".' });
      return;
    }

    const now = new Date();
    let clockState;

    if (action === "reset") {
      clockState = { startedAt: now.toISOString(), pausedAt: null };
    } else {
      const rows = await supabaseRequest("draft_config?select=clock_state&id=eq.1");
      const current = (rows && rows[0] && rows[0].clock_state) || {};

      if (action === "pause") {
        // Pausing an already-paused clock is a no-op, not a re-pause — that
        // would silently discard the time banked by the first pause.
        if (current.pausedAt) {
          res.status(200).json({ ok: true, clockState: current, unchanged: true });
          return;
        }
        // With no startedAt yet there's nothing running; anchor to now so the
        // pause has something to freeze.
        clockState = { startedAt: current.startedAt || now.toISOString(), pausedAt: now.toISOString() };
      } else {
        if (!current.pausedAt) {
          res.status(200).json({ ok: true, clockState: current, unchanged: true });
          return;
        }
        const pausedMs = now.getTime() - new Date(current.pausedAt).getTime();
        const started = current.startedAt ? new Date(current.startedAt).getTime() : now.getTime();
        clockState = { startedAt: new Date(started + pausedMs).toISOString(), pausedAt: null };
      }
    }

    await supabaseRequest("draft_config?id=eq.1", { method: "PATCH", body: { clock_state: clockState } });
    res.status(200).json({ ok: true, clockState });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
