# Player Lookup and Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live player-name autocomplete (sourced from Yahoo's player search API) to admin.html's manual pick-entry form, auto-filling Position/NFL Team and hiding already-drafted players.

**Architecture:** One new admin-gated Vercel function (`api/yahoo/players.js`) proxies Yahoo's `/league/{key}/players;search=` endpoint. `admin.html` debounces keystrokes in the Player Name field, calls that route via the existing `callAdminApi` helper, filters out names already present in `currentPicks` (already held in memory from the realtime subscription), and renders a dropdown reusing the site's existing `.search-results`/`.search-result` CSS classes.

**Tech Stack:** Vanilla JS, Vercel serverless functions (Node, CommonJS), Yahoo Fantasy Sports REST API, existing `lib/yahoo.js` helpers. No new dependencies, no build step (matches repo's zero-dependency `package.json`).

## Global Constraints

- No test framework exists in this repo (`npm install` is a no-op; see `CLAUDE.md`) — verification is manual (syntax checks + browser interaction), not automated tests.
- Every route that touches Yahoo or Supabase must call `requireAdmin(req, res)` first (`lib/auth.js`), even read-only ones — this is the existing pattern in every `api/*` file.
- Reuse `lib/yahoo.js`'s `yahooFetch` / `flattenYahooCollection`; don't duplicate OAuth/token logic.
- Reuse existing `.search-results` / `.search-result` CSS classes (`assets/style.css:93-119`) for the dropdown rather than introducing parallel styles — only add the minimal positioning rule needed.
- `escapeHtml` is already a global (defined in `js/history.js`, loaded before the inline script in `admin.html`) — use it, don't redefine it.

---

### Task 1: Backend route — `api/yahoo/players.js`

**Files:**
- Create: `api/yahoo/players.js`

**Interfaces:**
- Consumes: `yahooFetch(path)` and `flattenYahooCollection(node)` from `lib/yahoo.js` (both already exported); `requireAdmin(req, res)` from `lib/auth.js`.
- Produces: `POST /api/yahoo/players` — request body `{ q: string }`, response `{ players: [{ name: string, position: string, nflTeam: string }] }` on success, `{ error: string }` on failure. Consumed by Task 3's frontend code via `callAdminApi("/api/yahoo/players", { q })`.

- [ ] **Step 1: Write the route**

```js
// POST /api/yahoo/players — searches Yahoo's player database for
// autocomplete suggestions in admin.html's manual pick-entry form.
// Read-only, but still admin-gated like every other route that calls
// into Yahoo (see api/yahoo/sync.js for the same pattern).
const { yahooFetch, flattenYahooCollection } = require("../../lib/yahoo");
const { requireAdmin } = require("../../lib/auth");

// Yahoo often represents a "record" as an array of small single-key
// objects, e.g. [{name:"..."}, {display_position:"..."}, ...] — this
// flattens that into one plain object. Duplicated from api/yahoo/sync.js
// rather than shared, matching that file's existing local-helper pattern.
function flattenFieldArray(arr) {
  return Object.assign({}, ...(arr || []).filter(Boolean));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const q = ((req.body && req.body.q) || "").trim();
  if (q.length < 2) {
    res.status(200).json({ players: [] });
    return;
  }

  const leagueKey = process.env.YAHOO_LEAGUE_KEY;
  if (!leagueKey) {
    res.status(500).json({ error: "YAHOO_LEAGUE_KEY is not set in this project's environment variables." });
    return;
  }

  try {
    const playersJson = await yahooFetch(
      `/league/${leagueKey}/players;search=${encodeURIComponent(q)};count=10`
    );
    const playerNodes = flattenYahooCollection(playersJson.fantasy_content.league[1].players).map((p) =>
      flattenFieldArray(p.player[0])
    );
    const players = playerNodes
      .map((fields) => ({
        name: fields.name ? fields.name.full : "",
        position: fields.display_position || "",
        nflTeam: fields.editorial_team_abbr || ""
      }))
      .filter((p) => p.name);

    res.status(200).json({ players });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
```

- [ ] **Step 2: Verify the file parses**

Run: `node -c api/yahoo/players.js`
Expected: no output, exit code 0 (Node's `-c` flag checks syntax without executing).

- [ ] **Step 3: Verify against a live league (manual, best-effort)**

If `YAHOO_CLIENT_ID`/`YAHOO_CLIENT_SECRET`/`YAHOO_REDIRECT_URI`/`YAHOO_LEAGUE_KEY` are set and Yahoo is already connected (via `admin.html` → "Connect Yahoo Account"), run `vercel dev` and:

```bash
curl -s -X POST http://localhost:3000/api/yahoo/players \
  -H "Content-Type: application/json" \
  -H "x-admin-password: $ADMIN_PASSWORD" \
  -d '{"q":"chase"}'
```

Expected: `{"players":[...]}` with at least one entry containing `"Chase"` in the name. If Yahoo isn't connected in this environment, skip this step — Task 3's browser verification is the real gate, and per `CLAUDE.md` this endpoint "has not been run against a live league," so a field-path mismatch here is expected to be diagnosed via Vercel function logs later, not blocking this task.

- [ ] **Step 4: Commit**

```bash
git add api/yahoo/players.js
git commit -m "Add Yahoo player search API route for draft pick autocomplete"
```

---

### Task 2: CSS — position the suggestions dropdown

**Files:**
- Modify: `assets/style.css`

**Interfaces:**
- Consumes: existing `.search-results` / `.search-result` rules at `assets/style.css:93-119` (unchanged).
- Produces: `.player-autocomplete` class (position: relative anchor) and `.search-result.active` state, both consumed by Task 3's markup/JS.

- [ ] **Step 1: Add the CSS**

Add after the existing `.search-result:hover` rule (`assets/style.css:113`):

```css
.player-autocomplete {
  position: relative;
}

.search-result.active {
  background: var(--bg-panel-2);
}
```

- [ ] **Step 2: Verify no syntax breakage**

Open `admin.html` in a browser (`open admin.html` or via `vercel dev`) and confirm the page still renders with existing styling intact (header search box, pick form, board table all look unchanged) — a broken CSS file would visibly break layout across the whole page.

- [ ] **Step 3: Commit**

```bash
git add assets/style.css
git commit -m "Add CSS for player-autocomplete dropdown positioning"
```

---

### Task 3: Frontend — wire autocomplete into admin.html

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: `POST /api/yahoo/players` from Task 1 (response shape `{ players: [{ name, position, nflTeam }] }`); `.player-autocomplete` / `.search-result.active` CSS from Task 2; existing globals `callAdminApi` (`js/supabase-client.js`), `escapeHtml` (`js/history.js`), and the page's own `currentPicks` array (populated in `loadAll()`).
- Produces: no exports — this is the terminal consumer in this plan.

- [ ] **Step 1: Wrap the Player Name field in the autocomplete container**

In `admin.html`, replace:

```html
        <div>
          <label>Player Name</label>
          <input id="pick-player" type="text" placeholder="e.g. Ja'Marr Chase" />
        </div>
```

with:

```html
        <div class="player-autocomplete">
          <label>Player Name</label>
          <input id="pick-player" type="text" placeholder="e.g. Ja'Marr Chase" autocomplete="off" />
          <div id="player-suggestions" class="search-results" hidden></div>
        </div>
```

- [ ] **Step 2: Add the autocomplete JS**

In the `<script>` block at the bottom of `admin.html`, add after the `undoLastPick` function:

```js
  let playerSuggestions = [];
  let playerSuggestionIndex = -1;
  let playerSearchTimer = null;

  function wirePlayerAutocomplete() {
    const input = document.getElementById("pick-player");
    const dropdown = document.getElementById("player-suggestions");

    input.addEventListener("input", () => {
      clearTimeout(playerSearchTimer);
      const q = input.value.trim();
      if (q.length < 2) {
        hidePlayerSuggestions();
        return;
      }
      playerSearchTimer = setTimeout(() => searchPlayers(q), 300);
    });

    input.addEventListener("keydown", (e) => {
      if (dropdown.hidden) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        playerSuggestionIndex = Math.min(playerSuggestionIndex + 1, playerSuggestions.length - 1);
        renderPlayerSuggestions();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        playerSuggestionIndex = Math.max(playerSuggestionIndex - 1, -1);
        renderPlayerSuggestions();
      } else if (e.key === "Enter" && playerSuggestionIndex >= 0) {
        e.preventDefault();
        selectPlayerSuggestion(playerSuggestionIndex);
      } else if (e.key === "Escape") {
        hidePlayerSuggestions();
      }
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        hidePlayerSuggestions();
      }
    });
  }

  async function searchPlayers(q) {
    try {
      const alreadyDrafted = new Set((currentPicks || []).map((p) => (p.player || "").toLowerCase()));
      const result = await callAdminApi("/api/yahoo/players", { q });
      playerSuggestions = (result.players || []).filter((p) => !alreadyDrafted.has(p.name.toLowerCase()));
      playerSuggestionIndex = -1;
      renderPlayerSuggestions();
    } catch (e) {
      console.warn("Player autocomplete failed:", e.message);
      hidePlayerSuggestions();
    }
  }

  function renderPlayerSuggestions() {
    const dropdown = document.getElementById("player-suggestions");
    if (!playerSuggestions.length) {
      hidePlayerSuggestions();
      return;
    }
    dropdown.innerHTML = playerSuggestions
      .map(
        (p, i) => `<div class="search-result${i === playerSuggestionIndex ? " active" : ""}" data-index="${i}">
          <span class="search-text">${escapeHtml(p.name)}</span>
          <span class="search-breadcrumb">${escapeHtml(p.position || "")}${p.nflTeam ? " · " + escapeHtml(p.nflTeam) : ""}</span>
        </div>`
      )
      .join("");
    dropdown.hidden = false;
    dropdown.querySelectorAll(".search-result").forEach((el) => {
      el.addEventListener("click", () => selectPlayerSuggestion(Number(el.dataset.index)));
    });
  }

  function selectPlayerSuggestion(index) {
    const p = playerSuggestions[index];
    if (!p) return;
    document.getElementById("pick-player").value = p.name;
    document.getElementById("pick-position").value = p.position || "";
    document.getElementById("pick-nflteam").value = p.nflTeam || "";
    hidePlayerSuggestions();
  }

  function hidePlayerSuggestions() {
    playerSuggestions = [];
    playerSuggestionIndex = -1;
    const dropdown = document.getElementById("player-suggestions");
    dropdown.hidden = true;
    dropdown.innerHTML = "";
  }
```

- [ ] **Step 3: Call `wirePlayerAutocomplete()` once on init**

In `admin.html`, modify the start of `initAdmin()`:

```js
  async function initAdmin() {
    sb = getSupabaseClient();
```

to:

```js
  async function initAdmin() {
    wirePlayerAutocomplete();
    sb = getSupabaseClient();
```

- [ ] **Step 4: Manual browser verification**

Open `admin.html` (via `vercel dev` so `/api/*` routes work), log in with the admin password, then:

1. Type 1 character in Player Name — confirm no dropdown appears and no network request fires (check browser DevTools Network tab).
2. Type 2+ characters of a real player's name (e.g. "cha") — confirm a request to `/api/yahoo/players` fires after ~300ms and, if Yahoo is connected in this environment, a dropdown of matches appears.
3. Click a suggestion — confirm Player Name, Position, and NFL Team fields all fill in and the dropdown closes.
4. Manually enter and submit a pick for a player (via "Add Pick"), then search for that same player's name again — confirm they no longer appear in suggestions (already-drafted filter).
5. Press Escape while the dropdown is open — confirm it closes without altering the typed text.
6. Click outside the field while the dropdown is open — confirm it closes.
7. If Yahoo is NOT connected in this environment: confirm typing still works normally, the fields are still submittable by hand, and the only symptom is a `console.warn` in DevTools — no thrown errors, no broken layout.
8. Confirm the pre-existing "Add Pick" / "Undo Last Pick" buttons and the Draft Order section still work unchanged (regression check).

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "Wire live player-search autocomplete into manual pick entry"
```
