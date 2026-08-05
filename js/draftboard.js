// Shared snake-draft math + board rendering used by draft.html (public,
// read-only) and admin.html (entry form + live preview).

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

function renderBoard(containerId, config, picksData, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const numTeams = config.teams.length;
  const rounds = config.rounds;
  const picks = picksData.picks || [];
  const pickByOverall = {};
  picks.forEach((p) => {
    if (p.overallPick) pickByOverall[p.overallPick] = p;
    else pickByOverall[overallPickForRoundSlot(p.round, p.slot, numTeams)] = p;
  });

  const nextOverall = picks.length + 1;
  const onClock = nextOverall <= numTeams * rounds ? slotForOverallPick(nextOverall, numTeams) : null;

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
          <div class="meta">${escapeHtml(pick.position || "")}${pick.nflTeam ? " - " + escapeHtml(pick.nflTeam) : ""}</div>
          <div class="meta">Pick #${overall}</div>
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

  if (opts.onRendered) opts.onRendered({ nextOverall, onClock, totalPicks: numTeams * rounds, picksMade: picks.length });
}
