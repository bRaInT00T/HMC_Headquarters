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

// config: { rounds, teams: [{slot, owner}, ...] }
// picks: array of rows from the draft_picks table (overall_pick, round, slot, team, player, position, nfl_team)
function renderBoard(containerId, config, picks, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const numTeams = config.teams.length;
  const rounds = config.rounds;
  const pickByOverall = {};
  (picks || []).forEach((p) => {
    pickByOverall[p.overall_pick] = p;
  });

  const picksMade = (picks || []).length;
  const nextOverall = picksMade + 1;
  const totalPicks = numTeams * rounds;
  const onClock = nextOverall <= totalPicks ? slotForOverallPick(nextOverall, numTeams) : null;

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
      if (pick) {
        html += `<td class="pick-cell filled">
          <div class="player">${escapeHtml(pick.player || "")}</div>
          <div class="meta">${escapeHtml(pick.position || "")}${pick.nfl_team ? " - " + escapeHtml(pick.nfl_team) : ""}</div>
          <div class="meta">Pick #${overall}${pick.source === "yahoo" ? " · synced" : ""}</div>
        </td>`;
      } else {
        html += `<td class="pick-cell${isOnClock ? " on-clock" : ""}">
          ${isOnClock ? '<span class="live-dot"></span>on the clock' : `<span class="meta">#${overall}</span>`}
        </td>`;
      }
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  el.innerHTML = html;

  if (opts.onRendered) opts.onRendered({ nextOverall, onClock, totalPicks, picksMade });
}
