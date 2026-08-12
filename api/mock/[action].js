// POST /api/mock/pick | /api/mock/start | /api/mock/stop | /api/mock/undo —
// combined into one function (Vercel's Hobby plan caps serverless functions at
// 12) via the [action] dynamic segment. Each branch is the untouched body of
// the former api/mock/pick.js / start.js / stop.js / undo.js. Deliberately
// unauthenticated (see lib/mock.js) — anyone watching the board can drive a
// rehearsal, and every branch here writes solely to the mock_draft_* tables.
const { supabaseRequest } = require("../../lib/supabase");
const { MOCK_PICKS, MOCK_STATE, readMockState, restartMockClock, clearMockPicks } = require("../../lib/mock");

async function pick(req, res) {
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
}

async function start(req, res) {
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
}

async function stop(req, res) {
  const { keepPicks } = req.body || {};
  const now = new Date().toISOString();
  await supabaseRequest(MOCK_STATE, {
    method: "PATCH",
    body: { active: false, clock_state: {}, updated_at: now }
  });
  if (!keepPicks) await clearMockPicks();
  res.status(200).json({ active: false, cleared: !keepPicks });
}

async function undo(req, res) {
  const rows = await supabaseRequest(
    `${MOCK_PICKS}?select=overall_pick,team,player&order=overall_pick.desc&limit=1`
  );
  if (!rows || rows.length === 0) {
    res.status(200).json({ removed: null });
    return;
  }
  const last = rows[0];
  await supabaseRequest(`${MOCK_PICKS}?overall_pick=eq.${last.overall_pick}`, { method: "DELETE" });
  await restartMockClock();
  res.status(200).json({ removed: last });
}

const ACTIONS = { pick, start, stop, undo };

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const handler = ACTIONS[req.query.action];
  if (!handler) {
    res.status(404).json({ error: "Unknown mock action." });
    return;
  }

  try {
    await handler(req, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
