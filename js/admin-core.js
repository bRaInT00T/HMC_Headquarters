// Plumbing shared by the two commissioner pages: admin.html (pre-draft setup)
// and draft-entry.html (draft-day pick entry + live board). Everything here is
// page-agnostic — the password gate, the draft_config/draft_picks load and its
// realtime subscription, the team dropdowns, and the player autocomplete stack.
//
// Each page supplies its own `initPage()` (wiring) and registers one or more
// `onAdminLoad()` hooks, which run after every load/realtime refresh with
// currentConfig and currentPicks already populated.

let sb = null;
let currentConfig = null;
let currentPicks = null;

const adminLoadHooks = [];

// Register a function to run after every draft_config/draft_picks refresh.
function onAdminLoad(fn) {
  adminLoadHooks.push(fn);
}

// Cosmetic-looking, but real: this password is sent as x-admin-password
// on every write call and checked server-side against the ADMIN_PASSWORD
// env var (lib/auth.js). Only the local UI-unlock check below is
// client-side; nothing gets written without the server agreeing too.
function checkPassword() {
  const val = document.getElementById("gate-password").value;
  // fetch's Headers only accepts ISO-8859-1 in header values, and this
  // password is sent as the x-admin-password header on every write call —
  // catch a stray smart-quote/em-dash/emoji (common from pasting out of
  // Notes/Word/a password manager) here instead of a cryptic fetch error
  // on the first write.
  if (/[^\x00-\xFF]/.test(val)) {
    document.getElementById("gate-error").textContent =
      "Password contains a character outside plain ASCII/Latin-1 (often from pasting from Notes, Word, or a password manager) — retype it directly instead of pasting.";
    return;
  }
  localStorage.setItem("hmc_admin_password", val);
  unlockAdmin();
}

function unlockAdmin() {
  document.getElementById("gate").style.display = "none";
  document.getElementById("admin-content").style.display = "block";
  initAdmin();
}

async function initAdmin() {
  loadPlayerFilterOptions(); // constants only — must not wait on Supabase, or hide behind its failure paths
  if (typeof initPage === "function") initPage();
  sb = getSupabaseClient();
  if (new URLSearchParams(location.search).get("yahoo") === "connected") {
    setYahooStatus("Yahoo account connected.", "ok");
  }
  if (!sb) {
    const board = document.getElementById("board");
    if (board) {
      board.innerHTML = `<p style="color:var(--text-dim);">
        Not connected to Supabase yet — set SUPABASE_URL / SUPABASE_ANON_KEY in js/config.js.</p>`;
    }
    return;
  }
  // Warm the autocomplete's player list now rather than on the first
  // keystroke, so typing a name never waits on a fetch. Failing here is
  // survivable: loadPlayerIndex() doesn't cache the failure, so the first
  // search tries again.
  loadPlayerIndex().catch((e) => console.warn("Player list preload failed:", e.message));
  await loadAll();
  sb.channel("admin-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks" }, () => loadAll())
    .on("postgres_changes", { event: "*", schema: "public", table: "draft_config" }, () => loadAll())
    .subscribe();
}

async function loadAll() {
  const [{ data: cfgRows }, { data: picks }] = await Promise.all([
    sb.from("draft_config").select("*").eq("id", 1).limit(1),
    sb.from("draft_picks").select("*").order("overall_pick")
  ]);
  currentConfig = {
    rounds: cfgRows[0].rounds,
    teams: cfgRows[0].teams,
    draftDate: cfgRows[0].draft_date,
    // Columns are new; tolerate a project whose schema hasn't been re-run yet.
    traded_picks: cfgRows[0].traded_picks || [],
    clock_state: cfgRows[0].clock_state || {},
    // Absent until schema.sql is re-run — treat that as the safe end of the
    // range, so an un-migrated project behaves like a live draft.
    draftMode: cfgRows[0].draft_mode || "live",
    // Likewise absent pre-migration; {} resolves to the stylesheet palette.
    positionColors: cfgRows[0].position_colors || {}
  };
  currentPicks = picks;
  // Both pages paint picks by position, so the palette is applied centrally
  // rather than as a side effect of the settings page's colour pickers.
  applyPositionColors(resolvePositionColors(currentConfig.positionColors));
  renderSlotSelect();
  adminLoadHooks.forEach((fn) => fn());
}

// ── Teams ─────────────────────────────────────────────────────────────────

// "Team Name (Manager)" — the slot number is still the option's value, it just
// isn't what you read. Teams without a manager recorded fall back to the slot
// so the parenthetical never renders empty.
function draftTeamLabel(t) {
  const who = (t.manager || "").trim() || `slot ${t.slot}`;
  return `${t.owner} (${who})`;
}

function slotOwnerName(slot) {
  return currentConfig.teams.find((t) => t.slot === Number(slot))?.owner || `Slot ${slot}`;
}

// The team that actually makes the pick at (round, slot) — the slot's own
// team unless that pick was traded away.
function teamNameForPick(round, slot) {
  const owning = pickingSlotFor(round, slot, currentConfig.traded_picks || []);
  return currentConfig.teams.find((t) => t.slot === owning)?.owner || `Slot ${owning}`;
}

// Every team dropdown on either page draws from the same draft order; the ids
// that aren't on this page are simply skipped.
function renderSlotSelect() {
  const options = currentConfig.teams
    .map((t) => `<option value="${t.slot}">${escapeHtml(draftTeamLabel(t))}</option>`)
    .join("");
  ["pick-slot", "keeper-slot", "trade-team-a", "trade-team-b"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const previous = select.value;
    select.innerHTML = options;
    if (currentConfig.teams.some((t) => String(t.slot) === previous)) select.value = previous;
  });
  // Both sides of a trade would otherwise default to the same team, which is
  // the one combination the form rejects.
  const teamB = document.getElementById("trade-team-b");
  if (teamB && !teamB.dataset.touched && currentConfig.teams[1]) {
    teamB.value = String(currentConfig.teams[1].slot);
    teamB.addEventListener("change", () => { teamB.dataset.touched = "1"; }, { once: true });
  }
}

// ── Yahoo sync ────────────────────────────────────────────────────────────
// Connecting the account is setup (admin.html); running a sync is a draft-day
// action (draft-entry.html). Both pages carry a #yahoo-status line, so the
// calls themselves are shared.

let liveSyncTimer = null;

function setYahooStatus(text, kind) {
  const status = document.getElementById("yahoo-status");
  if (!status) return;
  status.textContent = text;
  status.className = kind ? `status-msg ${kind}` : "status-msg";
}

async function syncNow() {
  setYahooStatus("Syncing…");
  try {
    const result = await callAdminApi("/api/yahoo/sync", {});
    setYahooStatus(result.message || `Synced ${result.synced} pick(s) from Yahoo.`, "ok");
  } catch (e) {
    setYahooStatus("Error: " + e.message, "err");
  }
}

function toggleLiveSync() {
  const on = document.getElementById("live-sync-toggle").checked;
  if (on) {
    syncNow();
    liveSyncTimer = setInterval(syncNow, 20000);
  } else if (liveSyncTimer) {
    clearInterval(liveSyncTimer);
    liveSyncTimer = null;
  }
}

// ── Player autocomplete ───────────────────────────────────────────────────

// Our roster slots, mapped to the raw NFL positions balldontlie stores in
// nfl_players. Kickers come across as "PK" (K is listed too in case a future
// sync source uses it); fullbacks are RB-eligible for fantasy purposes.
// DEF is deliberately absent — team defenses aren't rows in nfl_players and
// are handled by teamDefenseSuggestions() instead.
const ROSTER_SLOT_POSITIONS = {
  QB: ["QB"],
  RB: ["RB", "FB"],
  WR: ["WR"],
  TE: ["TE"],
  "W/R/T": ["WR", "RB", "FB", "TE"],
  K: ["PK", "K"]
};

// Every position that can be drafted as an individual player. Used as the
// floor on every autocomplete query, so defenders (CB/LB/S/DE/DT), linemen
// and special-teamers can never be picked — a defense is drafted as a team,
// not as its players. It also filters out the ~8k retired players
// balldontlie returns with position "UNK".
const DRAFTABLE_POSITIONS = [...new Set(Object.values(ROSTER_SLOT_POSITIONS).flat())];

// Reverse of the above: a raw nfl_players position → the one Position option
// that describes it. W/R/T is skipped because it spans three positions, so
// it's never the single right answer for a specific player.
const POSITION_TO_SLOT_OPTION = Object.entries(ROSTER_SLOT_POSITIONS).reduce(
  (acc, [slot, positions]) => {
    if (slot !== "W/R/T") positions.forEach((p) => { if (!acc[p]) acc[p] = slot; });
    return acc;
  },
  { DEF: "DEF" }
);

// NFL_TEAM_NAMES comes from js/draftboard.js, loaded before this file —
// shared with draft.html so every page spells out team names the same way.

// The draftable half of nfl_players — ~2,000 rows — pulled once and held in
// memory, indexed for js/player-search.js. Fuzzy matching can't be pushed
// into the database (`ilike '%q%'` is exact-substring only, and Postgres
// trigram search would mean a migration and an RPC), so the list comes to the
// matcher instead. At roughly 60KB a page it's a cheap trade, and it makes
// every keystroke after the first search local and instant.
let playerIndex = null;
let playerIndexPromise = null;

// PostgREST caps a response at 1,000 rows, so this pages. full_name isn't
// unique (two Chris Johnsons, say), so id breaks ties — without a total
// order, rows can shift between pages and get fetched twice or never.
async function fetchPlayerIndex() {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 25; // a stop on the loop; the real list is ~2 pages
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await sb
      .from("nfl_players")
      .select("full_name, position, team")
      .in("position", DRAFTABLE_POSITIONS)
      .order("full_name")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows.map((p) =>
    PlayerSearch.indexEntry({ name: p.full_name, position: p.position, nflTeam: p.team })
  );
}

// Shared by every autocomplete, and kicked off in initAdmin() so the list is
// usually already there by the time anyone types. A failed load isn't cached —
// the next keystroke retries it.
function loadPlayerIndex() {
  if (playerIndex) return Promise.resolve(playerIndex);
  if (!playerIndexPromise) {
    playerIndexPromise = fetchPlayerIndex()
      .then((entries) => {
        playerIndex = entries;
        return entries;
      })
      .catch((e) => {
        playerIndexPromise = null;
        throw e;
      });
  }
  return playerIndexPromise;
}

// Call after anything that writes to nfl_players (the player sync), so the
// rows just written are findable without a page reload.
function invalidatePlayerIndex() {
  playerIndex = null;
  playerIndexPromise = null;
  loadPlayerIndex().catch(() => {}); // refill in the background; a keystroke retries on failure
}

// One of these per player-name box. Each owns its own suggestion list,
// debounce timer and in-flight sequence number, so typing in one can never
// clobber another's dropdown.
function createPlayerAutocomplete({ inputId, dropdownId, positionId, teamId }) {
  let suggestions = [];
  let activeIndex = -1;
  let searchTimer = null;
  let searchSeq = 0;
  let selected = null;

  const input = () => document.getElementById(inputId);
  const dropdown = () => document.getElementById(dropdownId);
  const filters = () => ({
    position: document.getElementById(positionId).value,
    nflTeam: document.getElementById(teamId).value
  });

  // With a position/team filter on, an empty box is a useful query (browse the
  // whole filtered list); with no filter it would mean "every NFL player".
  function queueSearch(delayMs) {
    clearTimeout(searchTimer);
    const q = input().value.trim();
    const { position, nflTeam } = filters();
    if (q.length < 2 && !position && !nflTeam) {
      hide();
      return;
    }
    if (delayMs) searchTimer = setTimeout(() => search(q), delayMs);
    else search(q);
  }

  async function search(q) {
    const seq = ++searchSeq;
    try {
      const alreadyDrafted = new Set((currentPicks || []).map((p) => (p.player || "").toLowerCase()));
      const { position, nflTeam } = filters();

      let results;
      if (position === "DEF") {
        results = teamDefenseSuggestions(q, nflTeam);
      } else {
        const entries = await loadPlayerIndex();
        if (seq !== searchSeq) return; // a newer search superseded this one; discard the stale load

        // Always constrain to draftable positions, even on "All skill
        // positions" — individual defenders are never a valid pick. The
        // index only holds draftable players, so "All" needs no filter.
        const positions = ROSTER_SLOT_POSITIONS[position];
        const pool = entries.filter(
          (p) =>
            (!positions || positions.includes(p.position)) &&
            (!nflTeam || p.nflTeam === nflTeam)
        );
        // On "All skill positions" a team defense is a valid pick too, so the
        // 32 defenses join the pool and get ranked alongside the players —
        // otherwise "cowboys" matches nothing until you already know to switch
        // the Position dropdown to DEF.
        results = PlayerSearch.rank(
          q,
          position ? pool : pool.concat(teamDefenseIndex(nflTeam)),
          25
        );
      }

      if (seq !== searchSeq) return;
      suggestions = results.filter((p) => !alreadyDrafted.has(p.name.toLowerCase()));
      activeIndex = -1;
      render();
    } catch (e) {
      if (seq !== searchSeq) return;
      console.warn("Player autocomplete failed:", e.message);
      hide();
    }
  }

  function render() {
    const el = dropdown();
    if (!suggestions.length) {
      hide();
      return;
    }
    el.innerHTML = suggestions
      .map(
        (p, i) => `<div class="search-result${i === activeIndex ? " active" : ""}" data-index="${i}">
          <span class="search-text">${escapeHtml(p.name)}</span>
          <span class="search-breadcrumb">${escapeHtml(p.position || "")}${p.nflTeam ? " · " + escapeHtml(p.nflTeam) : ""}</span>
        </div>`
      )
      .join("");
    el.hidden = false;
    el.querySelectorAll(".search-result").forEach((node) => {
      node.addEventListener("click", () => choose(Number(node.dataset.index)));
    });
    // The filtered list can be longer than the dropdown is tall — keep the
    // arrow-key selection visible.
    const active = el.querySelector(".search-result.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function choose(index) {
    const p = suggestions[index];
    if (!p) return;
    input().value = p.name;
    selected = p;

    // Mirror the chosen player's own position and NFL team into the dropdowns.
    // Assigning .value fires no change event, so this can't retrigger the
    // search whose handler would clear `selected`.
    const positionSelect = document.getElementById(positionId);
    const slotOption = POSITION_TO_SLOT_OPTION[p.position] || "";
    if ([...positionSelect.options].some((o) => o.value === slotOption)) {
      positionSelect.value = slotOption;
    }
    // Free agents come across with no team — fall back to "Any" rather than
    // leaving whatever was selected before, which would misdescribe the player.
    document.getElementById(teamId).value =
      p.nflTeam && NFL_TEAM_NAMES[p.nflTeam] ? p.nflTeam : "";

    hide();
  }

  function hide() {
    clearTimeout(searchTimer);
    searchSeq++; // invalidate any in-flight search() so it can't reopen this dropdown
    suggestions = [];
    activeIndex = -1;
    const el = dropdown();
    el.hidden = true;
    el.innerHTML = "";
  }

  // Matching is local once the player list is in memory, so there's no
  // network call to debounce — the delay is only there to keep a fast typist
  // from re-ranking the list on every keystroke.
  input().addEventListener("input", () => {
    selected = null;
    queueSearch(60);
  });

  // Changing a filter re-runs the current search so the list narrows in place.
  [positionId, teamId].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      selected = null;
      queueSearch(0);
    });
  });

  input().addEventListener("keydown", (e) => {
    if (dropdown().hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, suggestions.length - 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      render();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === "Escape") {
      hide();
    }
  });

  document.addEventListener("click", (e) => {
    if (!input().contains(e.target) && !dropdown().contains(e.target)) hide();
  });

  return {
    get selected() { return selected; },
    set selected(v) { selected = v; },
    hide,
    reset() {
      input().value = "";
      document.getElementById(positionId).value = "";
      document.getElementById(teamId).value = "";
      selected = null;
      hide();
    }
  };
}

// The NFL is a fixed 32 teams and Position is a fixed list of our roster
// slots, so both dropdowns are built from constants rather than discovered by
// paging the 13k-row nfl_players table. Values stay abbreviations (what the
// `team` column holds); labels are the full names. Ids missing from this page
// are skipped.
function loadPlayerFilterOptions() {
  const options =
    `<option value="">Any NFL team</option>` +
    Object.entries(NFL_TEAM_NAMES)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([abbr, name]) => `<option value="${escapeHtml(abbr)}">${escapeHtml(name)}</option>`)
      .join("");
  ["pick-nflteam", "keeper-nflteam", "inline-nflteam"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const previous = select.value;
    select.innerHTML = options;
    if (NFL_TEAM_NAMES[previous]) select.value = previous;
  });
}

// The 32 team defenses, drafted by full team name rather than as individual
// defenders. Not backed by nfl_players, so this is matched in memory — by the
// same fuzzy rules as players, plus each team's abbreviation as an alias, so
// "sf" finds the 49ers.
let defenseIndex = null;

function teamDefenseSuggestions(q, nflTeam) {
  if (!defenseIndex) {
    defenseIndex = Object.entries(NFL_TEAM_NAMES).map(([abbr, name]) =>
      PlayerSearch.indexEntry({ name, position: "DEF", nflTeam: abbr }, abbr)
    );
  }
  const pool = nflTeam ? defenseIndex.filter((d) => d.nflTeam === nflTeam) : defenseIndex;
  return PlayerSearch.rank(q, pool, 25);
}

// Stay logged in across reloads: if a password is already cached from a
// prior visit, skip the gate entirely (same trust model as checkPassword —
// the server is still the real check on every write). Otherwise put the
// cursor straight in the password field. Deferred to DOMContentLoaded so the
// page's own script — which defines initPage() — has been parsed first.
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("hmc_admin_password")) {
    unlockAdmin();
  } else {
    document.getElementById("gate-password").focus();
  }
});
