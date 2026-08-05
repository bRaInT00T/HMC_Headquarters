# Global Search (Rules + Settings) — Design

## Goal
A site-wide search box, present in the header on every page, that searches the
content of `data/rules.json` and `data/settings.json` and jumps the user to the
matching section/row on `rules.html` / `settings.html`, with it highlighted.

## Scope
- Searchable: rules section titles + bullet items; settings table rows
  (mechanics, offense, kickers, D/ST scoring).
- Not searchable: draft picks/teams/players, static nav pages (Home, Draft
  Board, Admin) — those stay reachable via the existing nav only.

## Components

**`js/search.js`** (new, loaded after `js/config.js` on all 5 pages)
- On load, fetches `data/rules.json` and `data/settings.json` and flattens
  them into an in-memory array of `{ page, hash, breadcrumb, text }`:
  - Rules: one entry per section title (`hash: rules-sec-<s>`), one per bullet
    item (`hash: rules-item-<s>-<i>`, breadcrumb = section title).
  - Settings: one entry per row in each of the 4 tables (`hash:
    settings-row-<table>-<r>`, breadcrumb = table name).
- Wires the header `<input id="global-search">`: on `input`, case-insensitive
  substring match against `text` + `breadcrumb`, cap at 8 results, render into
  a dropdown (`#search-results`) as links (`breadcrumb` + snippet) pointing to
  `<page>.html#<hash>`. Escape key or click-outside closes the dropdown.
- Exposes a helper, `highlightHash()`, that on any page checks
  `location.hash`, scrolls the matching element into view, and toggles a
  `.search-highlight` class that's removed after ~2s (CSS handles the fade).

**`rules.html` / `settings.html` render code**
- Add deterministic `id` attributes matching the hash scheme above to each
  rendered section, `<li>`, and table `<tr>`.
- Call `highlightHash()` after rendering completes (and on `hashchange`, so
  clicking a result while already on the page still scrolls/highlights).

**All 5 HTML pages (`index`, `rules`, `settings`, `draft`, `admin`)**
- Add a search `<input>` + results dropdown container to the shared
  `.site-header` markup, and include `<script src="js/search.js">`.

**`assets/style.css`**
- Styles for the search input/dropdown (matching existing header/nav look)
  and a `.search-highlight` fade-out keyframe animation.

## Error handling
Same posture as the existing `loadRules`/`loadSettings` fetches: if
rules.json/settings.json fail to load, search.js logs to console and leaves
the search box inert (no results) rather than breaking the page — this
mirrors the existing `.catch()` pattern already used for the two loaders.

## Out of scope
Draft-pick/player search, fuzzy/typo-tolerant matching, keyboard nav within
the results dropdown (arrow keys) — plain substring match and mouse/Enter
selection only, matching the "no build step, vanilla JS" scope of this repo.
