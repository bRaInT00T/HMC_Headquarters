// POST /api/draft-config/save — updates the singleton draft_config row
// (owner-per-slot draft order, rounds, format, date). Body may include any
// subset of { teams, rounds, season, draftDate, format }.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

const DRAFT_MODES = ["live", "mock", "testing"];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const { teams, rounds, season, draftDate, format, tradedPicks, draftMode } = req.body || {};
    const patch = {};
    if (draftMode !== undefined) {
      // Matches the draft_config_mode check constraint — rejected here with a
      // readable message rather than as a raw Postgres constraint violation.
      if (!DRAFT_MODES.includes(draftMode)) {
        res.status(400).json({ error: `draftMode must be one of: ${DRAFT_MODES.join(", ")}.` });
        return;
      }
      patch.draft_mode = draftMode;
    }
    if (teams) patch.teams = teams;
    // Sent as a whole array (the admin UI edits the full list), so an empty
    // array has to be accepted — it means "no trades", not "nothing to update".
    if (Array.isArray(tradedPicks)) {
      patch.traded_picks = tradedPicks
        .filter((t) => t && t.round && t.fromSlot && t.toSlot)
        .map((t) => ({ round: Number(t.round), fromSlot: Number(t.fromSlot), toSlot: Number(t.toSlot) }));
    }
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
