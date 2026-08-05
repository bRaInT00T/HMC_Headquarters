# Player lookup and autocomplete — design

## Problem

`admin.html`'s "Record a Pick Manually" form (the fallback path for leagues not drafting inside
Yahoo, or for fixing a synced pick) has free-text Player Name / Position / NFL Team inputs. The
commissioner has to know and correctly spell every player, position, and team abbreviation by
hand. There's no player dataset anywhere in the repo today — `draft_picks` just stores whatever
strings are typed in (or whatever Yahoo sync wrote).

## Goal

As the commissioner types in the Player Name field, show live suggestions sourced from Yahoo's
player search API. Selecting a suggestion auto-fills Position and NFL Team. Players already
recorded in the current draft are filtered out of suggestions.

Out of scope: the public draft board (`draft.html`) gets no changes — this is admin-only tooling.
No static player dataset is introduced; Yahoo is the sole data source, reusing the OAuth
connection admin.html already sets up for draft sync.

## Data source

Yahoo's Fantasy API supports player search: `/league/{league_key}/players;search={q}`. This is
fetched live per-keystroke (debounced) rather than cached into a static file, so it needs no
maintenance across seasons and stays consistent with the "Yahoo sync" section already on
admin.html. Same envelope-flattening approach already used in `api/yahoo/sync.js` applies here
(`flattenYahooCollection`, per-field array flattening).

Tradeoff accepted: this depends on Yahoo being connected and `YAHOO_LEAGUE_KEY` being set. If
Yahoo isn't connected, or the API call fails, autocomplete silently produces no suggestions —
the manual text inputs remain fully functional either way, so there's no hard dependency.

## Components

### 1. New API route — `api/yahoo/players.js`

- `POST /api/yahoo/players`, body `{ q }`.
- Admin-gated via `requireAdmin` (`lib/auth.js`), same as every other write-adjacent route in
  this app, even though this one only reads.
- If `q` is missing or shorter than 2 characters, returns `{ players: [] }` immediately —
  no Yahoo call.
- Otherwise calls `yahooFetch('/league/${leagueKey}/players;search=${encodeURIComponent(q)};count=10')`,
  flattens the response the same way `api/yahoo/sync.js` flattens `draftresults`/`players`
  collections, and returns:
  ```json
  { "players": [{ "name": "Ja'Marr Chase", "position": "WR", "nflTeam": "CIN" }] }
  ```
- `YAHOO_LEAGUE_KEY` missing, Yahoo not connected, or a Yahoo API error all resolve to a normal
  `{ error }` JSON response (matching the existing error-handling pattern in `api/yahoo/sync.js`)
  — no special-casing needed client-side beyond "suggestions failed, show none."

### 2. Frontend — `admin.html`

- Wrap the existing Player Name `<input id="pick-player">` in a new `.player-autocomplete`
  container so a suggestions dropdown can be positioned under just that field. New CSS rules
  modeled directly on the existing `.site-search` / `.search-results` / `.search-result` classes
  (`assets/style.css:74-119`) used by the header search box — same look, scoped to this
  container instead of the header.
- On `input`:
  - Debounce 300ms.
  - Skip the call entirely if the trimmed value is under 2 characters (hide any open dropdown).
  - Call `callAdminApi("/api/yahoo/players", { q })`.
  - Filter results client-side, dropping any suggestion whose `name` case-insensitively matches
    a `player` already present in `currentPicks` (the array `admin.html` already loads and keeps
    live via the Supabase realtime subscription) — no server-side plumbing needed for this since
    the admin page already holds the current pick list in memory.
  - Render up to 10 results as `name — position · nflTeam`.
- Selecting a suggestion (click, or Enter/arrow-key keyboard nav matching the header search box's
  existing keydown handling) fills `#pick-player`, `#pick-position`, `#pick-nflteam` and closes
  the dropdown.
- Escape or click-outside closes the dropdown (same behavior as `js/search.js`'s existing
  handlers).
- Any fetch/API error is caught, logged with `console.warn`, and treated as "no suggestions" —
  never blocks or clears what the commissioner has typed.

### 3. No changes elsewhere

`draft.html`, `js/draftboard.js`, `data/*.json`, and `supabase/schema.sql` are untouched. This is
additive: one new read-only API route plus autocomplete behavior layered onto an existing input.

## Testing

No test suite in this repo (per CLAUDE.md). Verify manually in a browser:
- With Yahoo connected and a league key set: type a partial player name, confirm suggestions
  appear, confirm selecting one fills all three fields, confirm a player already in
  `currentPicks` doesn't reappear in suggestions.
- With Yahoo not connected: confirm typing still works with no dropdown and no console errors
  breaking the page (a `console.warn` is fine).
- Confirm the existing "Add Pick" flow (manual entry, no autocomplete interaction) still works
  unchanged.
