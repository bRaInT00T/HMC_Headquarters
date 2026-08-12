// POST /api/picks/add | /api/picks/remove | /api/picks/undo — combined into one
// function (Vercel's Hobby plan caps serverless functions at 12) via the
// [action] dynamic segment. Each branch is the untouched body of the former
// api/picks/add.js / remove.js / undo.js.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

async function add(req, res) {
  const { round, slot, player, position, nflTeam, team, numTeams, source } = req.body || {};
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
  // pause). Keepers are entered before draft day and must not touch it.
  if (source !== "keeper") {
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

const ACTIONS = { add, remove, undo };

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
