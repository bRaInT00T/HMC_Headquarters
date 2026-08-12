// POST /api/picks/add | remove | undo | reset — combined into one function
// (Vercel's Hobby plan caps serverless functions at 12) via the [action]
// dynamic segment. add/remove/undo are the untouched bodies of the former
// api/picks/add.js / remove.js / undo.js; reset clears the whole board and is
// gated on draft_config.draft_mode.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");
const { parseDraftDate } = require("../../js/countdown");

async function add(req, res) {
  const { round, slot, player, position, nflTeam, team, numTeams, source, restartClock } = req.body || {};
  if (!round || !slot || !player || !numTeams) {
    res.status(400).json({ error: "round, slot, player, and numTeams are required." });
    return;
  }
  const posInRound = round % 2 === 1 ? slot : numTeams + 1 - slot;
  const overallPick = (round - 1) * numTeams + posInRound;

  await supabaseRequest("draft_picks", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: [
      {
        overall_pick: overallPick,
        round,
        slot,
        team: team || `Slot ${slot}`,
        player,
        position: position || "",
        nfl_team: nflTeam || "",
        // Only 'keeper' is accepted from the client; anything else is a
        // normal live pick. Yahoo sync writes 'yahoo' on its own path.
        source: source === "keeper" ? "keeper" : "manual"
      }
    ]
  });

  // A live pick puts the next team on the clock, so restart it (and clear any
  // pause). Keepers are entered before draft day and must not touch it, and
  // neither does correcting an already-recorded pick — the board's inline editor
  // sends restartClock:false so fixing a typo on pick #3 during pick #50 doesn't
  // hand every team a fresh two minutes. Absent, it defaults to restarting.
  if (source !== "keeper" && restartClock !== false) {
    await supabaseRequest("draft_config?id=eq.1", {
      method: "PATCH",
      body: { clock_state: { startedAt: new Date().toISOString(), pausedAt: null } }
    });
  }

  res.status(200).json({ overallPick });
}

async function remove(req, res) {
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
}

async function undo(req, res) {
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
}

// Wipes the board back to empty — the whole point of the mock/testing modes.
// The guard is here rather than only in the admin UI because a disabled button
// is not a safeguard: an admin tab left open from before draft day would still
// happily fire this at a live draft in progress.
async function reset(req, res) {
  const includeKeepers = (req.body || {}).includeKeepers === true;

  const cfgRows = await supabaseRequest("draft_config?select=draft_mode,draft_date&id=eq.1");
  const cfg = (cfgRows && cfgRows[0]) || {};
  const mode = cfg.draft_mode || "live";

  if (mode === "live") {
    // Free-text column with no timezone, so this parses in the server's zone
    // (UTC on Vercel) while the admin UI parses it in the commissioner's. The
    // skew makes the server block slightly *earlier* than the local clock would
    // — the safe direction for a guard whose job is refusing to wipe a draft
    // that has already started. "TBD" never parses, so an unscheduled draft
    // stays resettable.
    const parsed = parseDraftDate(cfg.draft_date);
    if (parsed && parsed.at.getTime() <= Date.now()) {
      res.status(403).json({
        error:
          "This draft is in Live mode and its draft date has passed — the board can't be reset. " +
          "Switch to Mock or Testing mode first if this really is a rehearsal."
      });
      return;
    }
  }

  // PostgREST refuses an unfiltered DELETE; overall_pick is a positive-integer
  // primary key, so gte.1 is "every row".
  const filter = includeKeepers ? "overall_pick=gte.1" : "source=neq.keeper";
  const removed = await supabaseRequest(`draft_picks?${filter}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" }
  });

  // A board with no picks has nobody on the clock; leaving the old countdown
  // running would put a stale deadline on an empty board.
  await supabaseRequest("draft_config?id=eq.1", { method: "PATCH", body: { clock_state: {} } });

  res.status(200).json({ ok: true, removed: (removed || []).length, mode, includeKeepers });
}

const ACTIONS = { add, remove, undo, reset };

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const handler = ACTIONS[req.query.action];
  if (!handler) {
    res.status(404).json({ error: "Unknown picks action." });
    return;
  }

  try {
    await handler(req, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
