// Shared snake-draft math + board rendering used by draft.html (public,
// realtime read-only) and admin.html (entry form + live preview).
// Field names match the Supabase draft_picks table (snake_case) directly.

// draft_picks.nfl_team holds the abbreviation Yahoo uses. Both the board cells
// and draft.html's spoken announcement spell it out — "Buffalo Bills" rather
// than "BUF". Anything unrecognised (or already spelled out) passes through.
const NFL_TEAM_NAMES = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys",
  DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
  JAC: "Jacksonville Jaguars", KC: "Kansas City Chiefs", LV: "Las Vegas Raiders",
  LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints",
  NYG: "New York Giants", NYJ: "New York Jets", PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers", SEA: "Seattle Seahawks",
  TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
  WSH: "Washington Commanders"
};

function nflTeamName(abbr) {
  const key = String(abbr || "").toUpperCase();
  return NFL_TEAM_NAMES[key] || abbr || "";
}

// ── Position colour coding ──────────────────────────────────────────────────
// Filled cells are tinted by the drafted player's position, and the legend below
// the toolbar spells the code out. This list is the single source of truth for
// the six groups: their order on the legend, the labels, and which raw position
// strings fold into each one.
//
// `covers` matters because the stored position comes from three sources that
// don't agree on spelling — Yahoo ("PK", "D/ST"), the nfl_players sync ("K",
// "DEF") and hand entry — and all of them have to land on the same colour.
// FB rides with RB. Anything unrecognised gets no group and keeps the neutral
// filled cell rather than borrowing another position's colour.
const POSITION_GROUPS = [
  { id: "qb", label: "Quarterback", covers: ["QB"] },
  { id: "rb", label: "Running Back", covers: ["RB", "FB"] },
  { id: "wr", label: "Wide Receiver", covers: ["WR"] },
  { id: "te", label: "Tight End", covers: ["TE"] },
  { id: "k", label: "Kicker", covers: ["K", "PK"] },
  { id: "def", label: "Defense", covers: ["DEF", "D/ST", "DST"] }
];

const POSITION_GROUP_IDS = POSITION_GROUPS.map((g) => g.id);

// Flattened { "QB": "qb", "PK": "k", … } lookup, built from `covers` so the
// list above stays the only place a position-to-colour decision is written down.
const POSITION_GROUP_BY_ABBR = {};
POSITION_GROUPS.forEach((g) => {
  g.covers.forEach((abbr) => {
    POSITION_GROUP_BY_ABBR[abbr] = g.id;
  });
});

function positionGroup(position) {
  const key = String(position || "").toUpperCase().trim();
  if (!key) return "";
  if (POSITION_GROUP_BY_ABBR[key]) return POSITION_GROUP_BY_ABBR[key];
  // "DEF - Buffalo", "DEF/ST" and the like.
  if (key.startsWith("DEF") || key.startsWith("D/ST")) return "def";
  return "";
}

// The position line inside a filled cell, coloured to match the cell's tint so
// the code reads even where the legend is off-screen.
function positionTagHtml(position) {
  if (!position) return "";
  return `<span class="pos-tag">${escapeHtml(position)}</span>`;
}

// Colours are CSS custom properties (--pos-color-qb …) rather than values baked
// into the markup: one property set on <html> recolours every cell, the legend
// and the admin swatches at once, with no re-render.
const POSITION_COLOR_VAR = (groupId) => `--pos-color-${groupId}`;

// Anything written into a style property has to be checked first — these values
// arrive from draft_config, and a custom property is a CSS injection vector.
// Six hex digits only; that's also exactly what <input type="color"> produces.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isValidPositionColor(value) {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim());
}

// The palette the stylesheet ships with, read back off :root once so the
// defaults live in exactly one place (assets/style.css) instead of being
// duplicated here for the admin page's colour pickers and its Reset button.
// Captured before any override is applied, so it survives one being set.
let defaultPositionColorCache = null;

function defaultPositionColors() {
  if (!defaultPositionColorCache) {
    const rootStyles = getComputedStyle(document.documentElement);
    defaultPositionColorCache = {};
    POSITION_GROUPS.forEach((g) => {
      const value = rootStyles.getPropertyValue(POSITION_COLOR_VAR(g.id)).trim();
      defaultPositionColorCache[g.id] = isValidPositionColor(value) ? value : "#5a6172";
    });
  }
  return { ...defaultPositionColorCache };
}

// Merges the league's saved overrides over the stylesheet defaults. Unknown keys
// and malformed values are dropped rather than trusted — an un-migrated project
// sends {} here and gets the defaults, which is the intended fallback.
function resolvePositionColors(saved) {
  const colors = defaultPositionColors();
  Object.entries(saved || {}).forEach(([id, value]) => {
    if (POSITION_GROUP_IDS.includes(id) && isValidPositionColor(value)) {
      colors[id] = value.trim().toLowerCase();
    }
  });
  return colors;
}

// Pushes the resolved palette onto <html>, where every --pos-color-* reference
// on the page picks it up. Passing nothing clears the overrides back to the
// stylesheet's own values.
function applyPositionColors(saved) {
  defaultPositionColors(); // snapshot the stylesheet values before overriding them
  const root = document.documentElement;
  const colors = resolvePositionColors(saved);
  POSITION_GROUPS.forEach((g) => {
    root.style.setProperty(POSITION_COLOR_VAR(g.id), colors[g.id]);
  });
  return colors;
}

// The key to the colour coding, rendered from the same list the cells use so the
// two can't drift. Lives inside .board-wrap so it comes along into full screen.
function renderPositionLegend(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = POSITION_GROUPS.map(
    (g) => `<span class="pos-legend-item pos-${g.id}">
      <span class="pos-swatch" aria-hidden="true"></span>${escapeHtml(g.covers[0])}
      <span class="meta">${escapeHtml(g.label)}</span>
    </span>`
  ).join("");
}

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
// working on a project that hasn't run the clock_state migration. delayMs pushes
// the deadline back by however long the pick took to announce, so the team on the
// clock still gets its full two minutes once the commissioner is done reading.
function resolvePickClock(clockState, fallbackAnchorMs, delayMs) {
  const state = clockState || {};
  const startedMs = state.startedAt ? new Date(state.startedAt).getTime() : fallbackAnchorMs;
  if (!startedMs) return null;

  const deadline = startedMs + (delayMs || 0) + PICK_CLOCK_SECONDS * 1000;
  if (state.pausedAt) {
    return { paused: true, remainingMs: clampRemaining(deadline - new Date(state.pausedAt).getTime()) };
  }
  return { paused: false, deadline };
}

// A delayed deadline can leave more than a full clock on the board; never show
// more time than a team actually gets.
function clampRemaining(ms) {
  return Math.max(0, Math.min(PICK_CLOCK_SECONDS * 1000, ms));
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

// One listener on the container, not one per cell: renderBoard() replaces the
// container's innerHTML on every realtime update, so per-cell handlers would need
// re-attaching each time. The container itself survives those renders, which is
// also why the listener is attached only once and reads the current callback off
// the element — re-adding it per render would stack duplicates and fire the
// callback N times on a single click. Enter and Space match the role="button"
// the cells advertise.
function wirePickCellClicks(container, onPickClick) {
  container._onPickClick = onPickClick;
  if (container.dataset.pickClicksWired) return;
  container.dataset.pickClicksWired = "1";

  const activate = (e) => {
    const cell = e.target.closest(".pick-cell.clickable");
    if (!cell) return;
    e.preventDefault();
    container._onPickClick(Number(cell.dataset.overall));
  };
  container.addEventListener("click", activate);
  container.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") activate(e);
  });
}

// Builds the clock markup for an empty, on-the-clock cell — identical in both
// the grid and the list view.
function pickClockHtml(clock) {
  if (!clock) return "";
  return clock.paused
    ? `<div class="pick-clock paused" data-frozen="${clock.remainingMs}">–:––</div>
       <div class="clock-note">${clock.held ? "announcing" : "paused"}</div>`
    : `<div class="pick-clock" data-deadline="${clock.deadline}">–:––</div>`;
}

// One column per team, one row per round — a team's picks always line up in
// the same column, and a traded pick stays in its original slot's column
// with a "via" note rather than jumping to the acquiring team's column.
function renderGridHtml({ config, numTeams, rounds, tradedPicks, ownerBySlot, pickByOverall, onClock, clock, opts }) {
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
        // Admin-only: passing onPickClick turns recorded picks into controls that
        // load themselves back into the entry form. The public board passes no
        // callback, so its cells stay inert markup.
        const clickable = Boolean(opts.onPickClick);
        const clickAttrs = clickable ? ` data-overall="${overall}" role="button" tabindex="0"` : "";
        // Marks the cell the entry form is pointed at, so it's visible which pick
        // a save would overwrite.
        const editing = opts.editingOverall === overall ? " editing" : "";
        const posGroup = positionGroup(pick.position);
        html += `<td class="pick-cell filled${posGroup ? ` pos-${posGroup}` : ""}${isKeeper ? " keeper" : ""}${clickable ? " clickable" : ""}${editing}"${clickAttrs}>
          <div class="player">${escapeHtml(pick.player || "")}</div>
          <div class="meta">${positionTagHtml(pick.position)}</div>
          ${pick.nfl_team ? `<div class="meta">${escapeHtml(nflTeamName(pick.nfl_team))}</div>` : ""}
          ${viaHtml}
          <div class="meta">${isKeeper ? '<span class="keeper-tag">Keeper</span> · ' : ""}Pick #${overall}${pick.source === "yahoo" ? " · synced" : ""}</div>
        </td>`;
      } else {
        html += `<td class="pick-cell${isOnClock ? " on-clock" : ""}${pickingSlot !== s ? " traded" : ""}">
          ${isOnClock ? `<span class="live-dot"></span>on the clock${pickClockHtml(clock)}` : `<span class="meta">#${overall}</span>`}
          ${viaHtml}
        </td>`;
      }
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

// One row per pick, in the order picks actually happen (overall pick number)
// rather than the grid's spatial team-column layout — easier to scan or
// scroll through as a running history of the draft.
function renderListHtml({ config, numTeams, rounds, tradedPicks, ownerBySlot, pickByOverall, onClock, clock, opts }) {
  const totalPicks = numTeams * rounds;
  let html = `<div class="board-list">`;

  for (let overall = 1; overall <= totalPicks; overall++) {
    const { round: r, slot: s } = slotForOverallPick(overall, numTeams);
    const pick = pickByOverall[overall];
    const isOnClock = onClock && onClock.round === r && onClock.slot === s;
    const pickingSlot = pickingSlotFor(r, s, tradedPicks);
    const viaHtml =
      pickingSlot !== s
        ? `<span class="meta via">via ${escapeHtml(ownerBySlot[pickingSlot] || `slot ${pickingSlot}`)}</span>`
        : "";
    const owner = ownerBySlot[s] || `Slot ${s}`;
    const numHtml = `<div class="list-pick-num">#${overall}<span class="meta">Rd ${r}</span></div>`;
    const teamHtml = `<div class="list-team">${escapeHtml(owner)}</div>`;

    if (pick) {
      const isKeeper = pick.source === "keeper";
      const clickable = Boolean(opts.onPickClick);
      const clickAttrs = clickable ? ` data-overall="${overall}" role="button" tabindex="0"` : "";
      const editing = opts.editingOverall === overall ? " editing" : "";
      const posGroup = positionGroup(pick.position);
      html += `<div class="pick-cell list-row filled${posGroup ? ` pos-${posGroup}` : ""}${isKeeper ? " keeper" : ""}${clickable ? " clickable" : ""}${editing}"${clickAttrs}>
        ${numHtml}
        ${teamHtml}
        <div class="list-player">
          <div class="player">${escapeHtml(pick.player || "")}</div>
          <div class="meta">${positionTagHtml(pick.position)}${pick.position && pick.nfl_team ? " · " : ""}${pick.nfl_team ? escapeHtml(nflTeamName(pick.nfl_team)) : ""}</div>
          ${viaHtml}
        </div>
        <div class="list-tag">${isKeeper ? '<span class="keeper-tag">Keeper</span>' : ""}${pick.source === "yahoo" ? '<span class="meta">synced</span>' : ""}</div>
      </div>`;
    } else {
      html += `<div class="pick-cell list-row${isOnClock ? " on-clock" : ""}${pickingSlot !== s ? " traded" : ""}">
        ${numHtml}
        ${teamHtml}
        <div class="list-player">
          ${isOnClock ? `<span class="live-dot"></span>on the clock${pickClockHtml(clock)}` : `<span class="meta">upcoming</span>`}
          ${viaHtml}
        </div>
        <div class="list-tag"></div>
      </div>`;
    }
  }

  html += `</div>`;
  return html;
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
  let clock = resolvePickClock(
    config.clock_state,
    liveEntries.length ? Math.max(...liveEntries) : null,
    opts.clockDelayMs
  );
  // opts.clockHeld: the public board sets this while the commissioner is reading
  // the previous pick out. The clock sits at a full two minutes rather than
  // ticking — it starts for real on the re-render that follows the announcement.
  if (clock && !clock.paused && opts.clockHeld) {
    clock = { paused: true, held: true, remainingMs: clampRemaining(clock.deadline - Date.now()) };
  }

  const html =
    opts.view === "list"
      ? renderListHtml({ config, numTeams, rounds, tradedPicks, ownerBySlot, pickByOverall, onClock, clock, opts })
      : renderGridHtml({ config, numTeams, rounds, tradedPicks, ownerBySlot, pickByOverall, onClock, clock, opts });
  el.innerHTML = html;
  if (opts.onPickClick) wirePickCellClicks(el, opts.onPickClick);
  startPickClocks();

  if (opts.onRendered) opts.onRendered({ nextOverall, onClock, totalPicks, picksMade });
}
