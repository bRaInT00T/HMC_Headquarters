// POST /api/draft-config/save — updates the singleton draft_config row
// (owner-per-slot draft order, rounds, format, date). Body may include any
// subset of { teams, rounds, season, draftDate, format, tradedPicks, draftMode,
// positionColors }.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

const DRAFT_MODES = ["live", "mock", "testing"];

// Mirrors js/draftboard.js:POSITION_GROUPS. These values end up as CSS custom
// properties on the public board, so the format is checked here rather than
// trusted — six-digit hex and nothing else, under a known group id.
const POSITION_GROUP_IDS = ["qb", "rb", "wr", "te", "k", "def"];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const { teams, rounds, season, draftDate, format, tradedPicks, draftMode, positionColors } =
      req.body || {};
    const patch = {};
    // Sent whole, like tradedPicks — the admin page edits the full palette, and
    // {} is a meaningful value meaning "back to the stylesheet defaults".
    if (positionColors !== undefined) {
      if (positionColors === null || typeof positionColors !== "object" || Array.isArray(positionColors)) {
        res.status(400).json({ error: "positionColors must be an object." });
        return;
      }
      const colors = {};
      for (const [id, value] of Object.entries(positionColors)) {
        if (!POSITION_GROUP_IDS.includes(id)) {
          res.status(400).json({ error: `Unknown position group "${id}".` });
          return;
        }
        if (typeof value !== "string" || !HEX_COLOR_RE.test(value.trim())) {
          res.status(400).json({ error: `Colour for "${id}" must be a hex value like #e08b3a.` });
          return;
        }
        colors[id] = value.trim().toLowerCase();
      }
      patch.position_colors = colors;
    }
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
        .map((t) => {
          const leg = { round: Number(t.round), fromSlot: Number(t.fromSlot), toSlot: Number(t.toSlot) };
          // Set only when true: a trade the commissioner waived a league rule
          // for. Kept off ordinary legs so the stored shape doesn't change for
          // every trade that followed the rules.
          if (t.override) leg.override = true;
          return leg;
        });
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
