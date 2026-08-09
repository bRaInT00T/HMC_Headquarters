// POST /api/picks/add — manual pick entry, used as a fallback when Yahoo
// sync isn't running (or for leagues not drafting inside Yahoo). Body:
// { round, slot, player, position, nflTeam, team, numTeams }.
const { supabaseRequest } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
