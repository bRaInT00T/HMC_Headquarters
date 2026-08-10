// POST /api/mock/pick — records a pick in the rehearsal draft. Body:
// { round, slot, player, position, nflTeam, team, numTeams }. Deliberately
// unauthenticated (see lib/mock.js) — anyone watching the board can take the
// pick that's on the clock.
const { supabaseRequest } = require("../../lib/supabase");
const { MOCK_PICKS, readMockState, restartMockClock } = require("../../lib/mock");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  try {
    const { round, slot, player, position, nflTeam, team, numTeams } = req.body || {};
    if (!round || !slot || !player || !numTeams) {
      res.status(400).json({ error: "round, slot, player, and numTeams are required." });
      return;
    }

    // No mock running means no board to write to — without this check a stale
    // tab could keep appending picks to a rehearsal someone else has ended.
    const state = await readMockState();
    if (!state.active) {
      res.status(409).json({ error: "No mock draft is running — start one first." });
      return;
    }

    const posInRound = round % 2 === 1 ? slot : numTeams + 1 - slot;
    const overallPick = (round - 1) * numTeams + posInRound;

    // merge-duplicates so two people submitting the same pick at once settle on
    // one row rather than one of them getting a 409 on the primary key.
    await supabaseRequest(MOCK_PICKS, {
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
          nfl_team: nflTeam || ""
        }
      ]
    });

    await restartMockClock();
    res.status(200).json({ overallPick });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
