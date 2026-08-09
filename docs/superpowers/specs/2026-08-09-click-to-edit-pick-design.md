# Click-to-edit a pick on the admin draft board

Date: 2026-08-09

## Problem

Correcting a recorded pick in `admin.html` today means reading the pick number off
the board and typing it into the "Pick #" field in section 5. The Live Preview sits
right there showing every pick, but it is inert — you can see the mistake and not
touch it. The commissioner is doing this mid-draft, under time pressure.

## Goal

Clicking a filled pick cell in the admin Live Preview loads that pick into the
existing "Record a Pick Manually" form, ready to overwrite.

## Non-goals

- Empty cells stay inert. Only picks that have something recorded are clickable.
- No inline or modal editor. The existing form is the editor.
- No Remove button on the pick form. `/api/picks/remove` stays wired only to
  keepers, and Undo stays the tool for the last live pick.
- The public board (`draft.html`) is unchanged.

## Why the existing form, not an inline editor

Almost all of the machinery already exists:

- `goToPick(overallPick)` (admin.html) sets Pick #, Round and Team from the snake
  order and calls `loadExistingPick()`.
- `loadExistingPick(overallPick)` fills Player / Position / NFL Team from the
  recorded row, primes `pickAutocomplete.selected` so an untouched re-save keeps the
  exact stored position and NFL team, and notes when the pick is a keeper or was
  traded.
- `POST /api/picks/add` upserts on `overall_pick` (`Prefer: resolution=merge-duplicates`),
  so saving a loaded pick overwrites it rather than appending.

An inline or modal editor would need a second copy of the player autocomplete, the
position/NFL-team filters, the traded-pick resolution and the save path. Routing the
click into the form reuses all of it, and keeps one place where a pick is written.

## Design

### `renderBoard()` — two opt-in fields on the existing `opts`

`js/draftboard.js:renderBoard(containerId, config, picks, opts)` is shared by the
public board and the admin preview. Both new behaviours are opt-in, so the public
board's markup is byte-for-byte what it is today.

- **`opts.onPickClick`** — a callback `(overallPick) => void`. When present, each
  *filled* cell renders with `data-overall="<n>"`, an added `clickable` class,
  `role="button"` and `tabindex="0"`. One delegated listener on the container
  handles `click`, plus `keydown` for Enter and Space, and resolves the cell via
  `event.target.closest(".pick-cell.clickable")`.
- **`opts.editingOverall`** — the overall pick number the form is currently pointed
  at. That cell renders with an added `editing` class, so it is visible which pick a
  save would overwrite.

Delegation (rather than a listener per cell) matters because `renderBoard()` replaces
`el.innerHTML` on every realtime event; per-cell listeners would be re-attached on
each render.

### `admin.html`

- `editPick(overallPick)`: calls `goToPick(overallPick)`, scrolls the pick form into
  view (`scrollIntoView({ behavior: "smooth", block: "center" })`), and focuses
  `#pick-player`.
- The three `renderBoard("board", …)` call sites (in `loadAll()`,
  `togglePickClock()` and `resetPickClock()`) pass
  `{ onPickClick: editPick, editingOverall: Number(document.getElementById("pick-number").value) || null }`.
- No change is needed to the `pickFormInUse` guard in `loadAll()`: once a click has
  filled `#pick-player`, that guard already stops the next realtime event from
  yanking the form back to the on-the-clock pick.

### `assets/style.css`

- `.pick-cell.clickable` — `cursor: pointer`, a hover treatment, and a
  `:focus-visible` ring so keyboard activation is visible.
- `.pick-cell.editing` — an outline marking the cell loaded in the form.

### Keeper-source fix

Clicking a keeper's cell puts an existing bug one click away. `submitPick()` does not
send `source`, so `api/picks/add.js` records the row as `manual` and — because the
row is no longer a keeper — restarts the pick clock (`api/picks/add.js:44`). Today
this needs someone to hand-type a keeper's pick number; with click-to-edit it is a
single click on a cell that is visibly tagged "Keeper".

Fix, scoped to exactly that: `loadExistingPick()` records the loaded row's `source`
in a module-level variable (cleared when the target pick is empty), and
`submitPick()` passes `source: "keeper"` back through when that is what was loaded.
A keeper edited this way stays a keeper, keeps its board tag, and does not touch the
clock.

## Verification

There is no test suite in this repo. Verify in a browser against `admin.html`:

1. Click a recorded live pick — the form scrolls into view, Pick #, Round, Team,
   Player, Position and NFL Team all match the cell, and the cell shows the
   `editing` outline.
2. Change the player and save — the board cell updates in place, no new pick is
   appended, and the pick count is unchanged.
3. Click a keeper's cell, save it untouched — it still renders with the Keeper tag,
   still has `source = 'keeper'`, and the on-the-clock timer does not restart.
4. Tab to a filled cell and press Enter — same as clicking it.
5. Click an empty cell — nothing happens.
6. Load `draft.html` — cells show no pointer cursor and clicking does nothing.
