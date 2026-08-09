// Shared snake-draft math + board rendering used by draft.html (public,
// realtime read-only) and admin.html (entry form + live preview).
// Field names match the Supabase draft_picks table (snake_case) directly.

function slotForOverallPick(overallPick, numTeams) {
  const round = Math.ceil(overallPick / numTeams);
  const posInRound = ((overallPick - 1) % numTeams) + 1;
  const slot = round % 2 === 1 ? posInRound : numTeams + 1 - posInRound;
  return { round, slot };
}

function overallPickForRoundSlot(round, slot, numTeams) {
  const posInRound = round % 2 === 1 ? slot : numTeams + 1 - slot;
  return (round - 1) * numTeams + posInRound;
}

// How long a team gets once the previous pick lands.
const PICK_CLOCK_SECONDS = 120;
let pickClockTimer = null;

function formatPickClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// One interval drives every .pick-clock on the page. renderBoard() rebuilds the
// table on each realtime update, so this is restarted (not stacked) per render.
// A paused clock carries data-frozen instead of data-deadline and never ticks.
function startPickClocks() {
  clearInterval(pickClockTimer);
  const tick = () => {
    const clocks = document.querySelectorAll(".pick-clock");
    if (!clocks.length) {
      clearInterval(pickClockTimer);
      return;
    }
    let anyRunning = false;
    clocks.forEach((el) => {
      let remaining;
      if (el.dataset.frozen !== undefined) {
        remaining = Math.max(0, Math.round(Number(el.dataset.frozen) / 1000));
      } else {
        anyRunning = true;
        remaining = Math.max(0, Math.round((Number(el.dataset.deadline) - Date.now()) / 1000));
      }
      el.textContent = remaining > 0 ? formatPickClock(remaining) : "time's up";
      el.classList.toggle("expired", remaining === 0);
    });
    // Nothing left to count down — stop waking up every second.
    if (!anyRunning) clearInterval(pickClockTimer);
  };
  tick();
  pickClockTimer = setInterval(tick, 1000);
}

// Resolves the stored clock into something renderable. clockState is
// draft_config.clock_state ({startedAt, pausedAt}); fallbackAnchorMs is the last
// live pick's timestamp, used when no clock has ever been set so the board keeps
// working on a project that hasn't run the clock_state migration.
function resolvePickClock(clockState, fallbackAnchorMs) {
  const state = clockState || {};
  const startedMs = state.startedAt ? new Date(state.startedAt).getTime() : fallbackAnchorMs;
  if (!startedMs) return null;

  const deadline = startedMs + PICK_CLOCK_SECONDS * 1000;
  if (state.pausedAt) {
    return { paused: true, remainingMs: Math.max(0, deadline - new Date(state.pausedAt).getTime()) };
  }
  return { paused: false, deadline };
}

// Who actually makes the pick sitting at (round, slot). Normally the slot's own
// team; if that pick was traded away, the team that acquired it.
// tradedPicks: [{round, fromSlot, toSlot}]
function pickingSlotFor(round, slot, tradedPicks) {
  const traded = (tradedPicks || []).find(
    (t) => Number(t.round) === round && Number(t.fromSlot) === slot
  );
  return traded ? Number(traded.toSlot) : slot;
}

// config: { rounds, teams: [{slot, owner, manager}, ...], traded_picks: [...] }
// picks: array of rows from the draft_picks table (overall_pick, round, slot, team, player, position, nfl_team, source, entered_at)
function renderBoard(containerId, config, picks, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const numTeams = config.teams.length;
  const rounds = config.rounds;
  const tradedPicks = config.traded_picks || [];
  const ownerBySlot = {};
  config.teams.forEach((t) => {
    ownerBySlot[t.slot] = t.owner;
  });

  const pickByOverall = {};
  (picks || []).forEach((p) => {
    pickByOverall[p.overall_pick] = p;
  });

  const picksMade = (picks || []).length;
  const totalPicks = numTeams * rounds;

  // The first pick with nothing recorded against it — NOT picksMade + 1.
  // Keepers are written in before the draft at scattered rounds, so the filled
  // picks are no longer a contiguous block from #1.
  let nextOverall = null;
  for (let o = 1; o <= totalPicks; o++) {
    if (!pickByOverall[o]) {
      nextOverall = o;
      break;
    }
  }
  const onClock = nextOverall ? slotForOverallPick(nextOverall, numTeams) : null;

  // The clock runs from the last pick actually made during the draft — a server
  // timestamp, so every viewer sees the same number and a reload doesn't restart
  // it. Keepers are excluded: they're entered days early, and counting from one
  // would put every team on the clock already expired.
  const liveEntries = (picks || [])
    .filter((p) => p.source !== "keeper" && p.entered_at)
    .map((p) => new Date(p.entered_at).getTime());
  const clock = resolvePickClock(config.clock_state, liveEntries.length ? Math.max(...liveEntries) : null);

  let html = `<table class="board"><thead><tr><th>Rd</th>`;
  config.teams.forEach((t) => {
    html += `<th>${escapeHtml(t.owner)} <span style="color:var(--text-dim)">(${t.slot})</span></th>`;
  });
  html += `</tr></thead><tbody>`;

  for (let r = 1; r <= rounds; r++) {
    html += `<tr><td class="round-label">${r}</td>`;
    for (let s = 1; s <= numTeams; s++) {
      const overall = overallPickForRoundSlot(r, s, numTeams);
      const pick = pickByOverall[overall];
      const isOnClock = onClock && onClock.round === r && onClock.slot === s;

      // A traded pick keeps its place in the snake order; only the team making
      // it changes, so the cell stays put and picks up a "via" line.
      const pickingSlot = pickingSlotFor(r, s, tradedPicks);
      const viaHtml =
        pickingSlot !== s
          ? `<div class="meta via">via ${escapeHtml(ownerBySlot[pickingSlot] || `slot ${pickingSlot}`)}</div>`
          : "";

      if (pick) {
        const isKeeper = pick.source === "keeper";
        html += `<td class="pick-cell filled${isKeeper ? " keeper" : ""}">
          <div class="player">${escapeHtml(pick.player || "")}</div>
          <div class="meta">${escapeHtml(pick.position || "")}${pick.nfl_team ? " - " + escapeHtml(pick.nfl_team) : ""}</div>
          ${viaHtml}
          <div class="meta">${isKeeper ? '<span class="keeper-tag">Keeper</span> · ' : ""}Pick #${overall}${pick.source === "yahoo" ? " · synced" : ""}</div>
        </td>`;
      } else {
        let clockHtml = "";
        if (isOnClock && clock) {
          clockHtml = clock.paused
            ? `<div class="pick-clock paused" data-frozen="${clock.remainingMs}">–:––</div>
               <div class="clock-note">paused</div>`
            : `<div class="pick-clock" data-deadline="${clock.deadline}">–:––</div>`;
        }
        html += `<td class="pick-cell${isOnClock ? " on-clock" : ""}${pickingSlot !== s ? " traded" : ""}">
          ${isOnClock ? `<span class="live-dot"></span>on the clock${clockHtml}` : `<span class="meta">#${overall}</span>`}
          ${viaHtml}
        </td>`;
      }
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  el.innerHTML = html;
  startPickClocks();

  if (opts.onRendered) opts.onRendered({ nextOverall, onClock, totalPicks, picksMade });
}
