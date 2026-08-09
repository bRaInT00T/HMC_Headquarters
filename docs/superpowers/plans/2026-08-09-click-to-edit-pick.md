# Click-to-Edit Pick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a recorded pick in the admin Live Preview board loads that pick into the existing "Record a Pick Manually" form, ready to overwrite.

**Architecture:** `renderBoard()` in `js/draftboard.js` is shared by the public board (`draft.html`) and the admin preview (`admin.html`). Both new behaviours — clickable cells and an "editing" highlight — are opt-in fields on its existing `opts` argument, so the public board's markup is unchanged. `admin.html` supplies an `editPick()` callback that delegates to the already-existing `goToPick()`, which fills the form; `POST /api/picks/add` upserts on `overall_pick`, so saving overwrites rather than appends.

**Tech Stack:** Plain browser JS (no build step, no bundler, no modules — scripts are loaded via `<script>` tags and share globals). Supabase via CDN. Vercel serverless functions in CommonJS.

## Global Constraints

- **No test suite exists in this repo, and this plan does not add one.** There is no test runner, no `npm test`, and `package.json` has zero dependencies. Every task is verified by loading the page in a browser and performing the listed checks. Do not scaffold Jest/Vitest/Playwright — that is a much larger decision than this feature.
- **No build step.** Edit the `.html`, `.js` and `.css` files directly. Do not introduce ES modules, imports, or a bundler.
- **`js/draftboard.js` is shared code.** `draft.html` is public and read-only. Any behaviour added for admin must be gated behind an `opts` field that `draft.html` does not pass.
- Match the surrounding comment style: the existing code explains *why* a non-obvious choice was made, not what the line does.
- Commit after each task.

**Spec:** `docs/superpowers/specs/2026-08-09-click-to-edit-pick-design.md`

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `js/draftboard.js` | Modify | Add `opts.onPickClick` (renders filled cells as buttons + one delegated listener) and `opts.editingOverall` (highlight class). |
| `admin.html` | Modify | Add `editPick()` and `refreshBoard()`; route all board renders through `refreshBoard()`; preserve a loaded pick's `source` on save. |
| `assets/style.css` | Modify | `.pick-cell.clickable` affordance + `:focus-visible` ring; `.pick-cell.editing` outline. |
| `draft.html` | **Unchanged** | Passes no `onPickClick`, so it renders exactly as today. |

---

### Task 1: Clickable pick cells wired to the entry form

**Files:**
- Modify: `js/draftboard.js:147-154` (the filled-cell branch), `js/draftboard.js:172` (after `el.innerHTML = html;`)
- Modify: `admin.html:356` (the `renderBoard` call in `loadAll()`)
- Modify: `assets/style.css:623` (after the `.on-clock` rule)
- Test: none — manual browser verification (see Global Constraints)

**Interfaces:**
- Consumes: `renderBoard(containerId, config, picks, opts)`, `goToPick(overallPick)` (already in `admin.html:705`).
- Produces:
  - `opts.onPickClick: (overallPick: number) => void` — optional. When passed, filled cells become activatable.
  - `wirePickCellClicks(container: HTMLElement, onPickClick: Function) => void` — module-level helper in `js/draftboard.js`.
  - `editPick(overallPick: number) => void` — global in `admin.html`.

- [ ] **Step 1: Make filled cells carry the click affordance**

In `js/draftboard.js`, replace the opening of the filled-cell branch (currently lines 147–149):

```js
      if (pick) {
        const isKeeper = pick.source === "keeper";
        html += `<td class="pick-cell filled${isKeeper ? " keeper" : ""}">
```

with:

```js
      if (pick) {
        const isKeeper = pick.source === "keeper";
        // Admin-only: passing onPickClick turns recorded picks into controls that
        // load themselves back into the entry form. The public board passes no
        // callback, so its cells stay inert markup.
        const clickable = Boolean(opts.onPickClick);
        const clickAttrs = clickable ? ` data-overall="${overall}" role="button" tabindex="0"` : "";
        html += `<td class="pick-cell filled${isKeeper ? " keeper" : ""}${clickable ? " clickable" : ""}"${clickAttrs}>
```

Leave the rest of the template literal (the `.player` / `.meta` / `viaHtml` lines and the closing `</td>`) exactly as it is.

- [ ] **Step 2: Attach the delegated listener after render**

In `js/draftboard.js`, the lines after the loop currently read:

```js
  el.innerHTML = html;
  startPickClocks();
```

Change to:

```js
  el.innerHTML = html;
  if (opts.onPickClick) wirePickCellClicks(el, opts.onPickClick);
  startPickClocks();
```

- [ ] **Step 3: Add the `wirePickCellClicks` helper**

In `js/draftboard.js`, add this function immediately *above* `function renderBoard(` (i.e. after `pickingSlotFor`):

```js
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
    const cell = e.target.closest("td.pick-cell.clickable");
    if (!cell) return;
    e.preventDefault();
    container._onPickClick(Number(cell.dataset.overall));
  };
  container.addEventListener("click", activate);
  container.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") activate(e);
  });
}
```

- [ ] **Step 4: Add `editPick()` to admin.html**

In `admin.html`, add this function immediately after `goToPick()` (which ends at line 716, just before the `// Editing is just re-entry:` comment):

```js
  // Clicking a recorded pick on the Live Preview is the same act as typing its
  // number into Pick # — the entry form is the editor, and /api/picks/add upserts
  // on overall_pick, so saving overwrites in place. preventScroll keeps focus()
  // from jumping the page and fighting the smooth scroll above it.
  function editPick(overallPick) {
    goToPick(overallPick);
    document.querySelector("form.pick-form").scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("pick-player").focus({ preventScroll: true });
  }
```

- [ ] **Step 5: Pass the callback from the admin board render**

In `admin.html:356`, change:

```js
    renderBoard("board", currentConfig, currentPicks);
```

to:

```js
    renderBoard("board", currentConfig, currentPicks, { onPickClick: editPick });
```

(The two other `renderBoard` call sites, in `togglePickClock()` and `resetPickClock()`, are handled in Task 2 — leave them alone for now.)

- [ ] **Step 6: Style the affordance**

In `assets/style.css`, immediately after line 623 (`table.board td.pick-cell.on-clock { outline: 2px solid var(--accent); }`), add:

```css
/* Admin only — recorded picks on the commissioner's preview board load back into
   the entry form when clicked. The public board never gets this class. */
table.board td.pick-cell.clickable { cursor: pointer; }
table.board td.pick-cell.clickable:hover { background: #232a23; }
table.board td.pick-cell.clickable:focus-visible {
  outline: 2px solid var(--accent-2);
  outline-offset: -2px;
}
```

- [ ] **Step 7: Verify in a browser**

Open `admin.html` (via `vercel dev`, or directly if Supabase config allows) and confirm all of:

1. A recorded pick cell shows a pointer cursor and a hover highlight.
2. Clicking it scrolls "Record a Pick Manually" into view, and Pick #, Round, Team, Player, Position and NFL Team all match that cell. The status line reads `Editing pick #N (Player) — saving overwrites it.`
3. Changing the player and clicking **Add Pick** updates that cell in place — no new pick appears, and no other cell changes.
4. Clicking an **empty** cell does nothing (no cursor change, no form movement).
5. Tabbing to a filled cell shows a focus ring; pressing Enter behaves like a click; pressing Space does too and does **not** scroll the page.
6. Click one pick, then another, then a third — the form follows each click exactly once. (If `goToPick` ran multiple times per click, the status line would still look right; instead confirm by watching for a single scroll, and check the browser console for errors.)
7. Open `draft.html`: pick cells have no pointer cursor, no hover change, and clicking does nothing.

- [ ] **Step 8: Commit**

```bash
git add js/draftboard.js admin.html assets/style.css
git commit -m "Load a pick into the entry form by clicking it on the admin board"
```

---

### Task 2: Highlight the pick currently loaded in the form

**Files:**
- Modify: `js/draftboard.js` (filled-cell branch from Task 1)
- Modify: `admin.html` — add `refreshBoard()`; update the three `renderBoard("board", …)` call sites (lines 356, 1106, 1121 pre-Task-1) and the end of `goToPick()`
- Modify: `assets/style.css` (after the `.clickable` rules from Task 1)
- Test: none — manual browser verification

**Interfaces:**
- Consumes: `opts.onPickClick` and the `clickable` class from Task 1; `editPick(overallPick)`; `goToPick(overallPick)`.
- Produces:
  - `opts.editingOverall: number | null` — optional. The overall pick number to mark with the `editing` class.
  - `refreshBoard() => void` — global in `admin.html`; the single place the admin board is rendered.

- [ ] **Step 1: Render the `editing` class**

In `js/draftboard.js`, in the filled-cell branch, extend the `clickable` line added in Task 1. Replace:

```js
        const clickable = Boolean(opts.onPickClick);
        const clickAttrs = clickable ? ` data-overall="${overall}" role="button" tabindex="0"` : "";
        html += `<td class="pick-cell filled${isKeeper ? " keeper" : ""}${clickable ? " clickable" : ""}"${clickAttrs}>
```

with:

```js
        const clickable = Boolean(opts.onPickClick);
        const clickAttrs = clickable ? ` data-overall="${overall}" role="button" tabindex="0"` : "";
        // Marks the cell the entry form is pointed at, so it's visible which pick
        // a save would overwrite.
        const editing = opts.editingOverall === overall ? " editing" : "";
        html += `<td class="pick-cell filled${isKeeper ? " keeper" : ""}${clickable ? " clickable" : ""}${editing}"${clickAttrs}>
```

- [ ] **Step 2: Add `refreshBoard()` to admin.html**

In `admin.html`, add this function immediately *above* `async function loadAll()` (line 318):

```js
  // The one place the admin board is rendered. editingOverall is read from the
  // form rather than passed in, because the form and the board have to agree
  // about which pick is loaded no matter which of them moved last.
  function refreshBoard() {
    if (!currentConfig || !currentPicks) return;
    renderBoard("board", currentConfig, currentPicks, {
      onPickClick: editPick,
      editingOverall: Number(document.getElementById("pick-number").value) || null
    });
  }
```

- [ ] **Step 3: Route every board render through it**

In `admin.html`, replace all three of these lines:

- in `loadAll()`: `renderBoard("board", currentConfig, currentPicks, { onPickClick: editPick });` (as left by Task 1)
- in `togglePickClock()`: `renderBoard("board", currentConfig, currentPicks);`
- in `resetPickClock()`: `renderBoard("board", currentConfig, currentPicks);`

each with:

```js
      refreshBoard();
```

(Watch the indentation: `loadAll()`'s call is indented 4 spaces, the two clock ones 6.)

- [ ] **Step 4: Re-render when the form moves**

The highlight has to follow the form when the form moves on its own — typing a pick number, changing Round or Team, saving, or undoing. Every one of those paths already funnels through `goToPick()`, so add the refresh at its end. In `admin.html`, `goToPick()` currently ends:

```js
    loadExistingPick(target);
  }
```

Change to:

```js
    loadExistingPick(target);
    refreshBoard();
  }
```

- [ ] **Step 5: Style the highlight**

In `assets/style.css`, immediately after the `.clickable` rules added in Task 1, add:

```css
/* The pick currently loaded in the entry form. Deliberately a different colour
   from .on-clock's outline — they're often two different cells. */
table.board td.pick-cell.editing {
  outline: 2px dashed var(--accent-2);
  outline-offset: -2px;
}
```

- [ ] **Step 6: Verify in a browser**

Reload `admin.html` and confirm all of:

1. On load, no cell carries the dashed outline unless the on-the-clock pick already has something recorded (normally none does).
2. Clicking a recorded pick draws the dashed outline on exactly that cell, and removes it from any previously outlined cell.
3. Typing a different number into **Pick #** and tabbing out moves the outline to that cell.
4. Changing the **Round** or **Team (Owner)** dropdown moves the outline accordingly.
5. Saving a pick moves the form to the next open pick and the outline disappears (that cell is now empty — empty cells never get the class).
6. **Pause Clock** and **Reset Clock** still work, still update the board, and do not clear the outline.
7. No console errors, and the clock in the on-the-clock cell still ticks once per second (not faster — that would mean stacked intervals).
8. `draft.html` is still unaffected: no outlines, no pointer cursor.

- [ ] **Step 7: Commit**

```bash
git add js/draftboard.js admin.html assets/style.css
git commit -m "Outline the pick the admin entry form is currently editing"
```

---

### Task 3: Keep a keeper a keeper when it's edited

**Files:**
- Modify: `admin.html` — `loadExistingPick()` (lines 720–758) and `submitPick()` (lines 640–678)
- Test: none — manual browser verification

**Interfaces:**
- Consumes: `loadExistingPick(overallPick)`, `submitPick()`, `POST /api/picks/add` (accepts `source: "keeper"`; anything else is recorded as `"manual"` — see `api/picks/add.js:37`).
- Produces: `loadedPickSource` — module-level `string | null` in `admin.html`, the `source` of the row currently loaded in the entry form.

**Why:** `submitPick()` sends no `source`, so re-saving a loaded keeper rewrites it as a `manual` pick *and* restarts the pick clock (`api/picks/add.js:44`) — a keeper is entered days early and must never touch the clock. Today that needs someone to hand-type a keeper's pick number; after Tasks 1–2 it is one click on a cell visibly tagged "Keeper".

- [ ] **Step 1: Record the loaded pick's source**

In `admin.html`, add the declaration immediately *above* the `// Editing is just re-entry:` comment block that precedes `loadExistingPick`:

```js
  // The source of the row currently in the entry form ('keeper', 'yahoo',
  // 'manual', or null when the pick is empty). Held so that re-saving a loaded
  // pick preserves what kind of pick it was.
  let loadedPickSource = null;
```

Then set it in both branches of `loadExistingPick()`. In the empty branch, the lines currently read:

```js
    if (!existing) {
      playerInput.value = "";
```

Change to:

```js
    if (!existing) {
      loadedPickSource = null;
      playerInput.value = "";
```

And in the filled branch, currently:

```js
    playerInput.value = existing.player || "";
```

Change to:

```js
    loadedPickSource = existing.source || null;
    playerInput.value = existing.player || "";
```

- [ ] **Step 2: Send it back on save**

In `admin.html`, `submitPick()` currently calls:

```js
      const result = await callAdminApi("/api/picks/add", {
        round, slot, player, position, nflTeam, team, numTeams: currentConfig.teams.length
      });
```

Change to:

```js
      // Editing a keeper must leave it a keeper: without this the row comes back
      // as a manual pick and the save restarts everyone's clock, for a pick that
      // was entered days before draft day.
      const result = await callAdminApi("/api/picks/add", {
        round, slot, player, position, nflTeam, team,
        numTeams: currentConfig.teams.length,
        source: loadedPickSource === "keeper" ? "keeper" : undefined
      });
```

- [ ] **Step 3: Verify in a browser**

With at least one keeper recorded (section 6 lists them), confirm all of:

1. Click a keeper's cell on the Live Preview. The status line reads `Editing pick #N (Player), a keeper — saving overwrites it.`
2. Note the current countdown in the on-the-clock cell. Click **Add Pick** without changing anything.
3. The cell still renders with the purple keeper background and the **KEEPER** tag, and the player still appears in the "Add a Keeper" list in section 6.
4. The on-the-clock countdown did **not** jump back to 2:00 — it kept counting down from where it was.
5. Now click an ordinary recorded live pick, change the player, and save. It stays a normal pick (no KEEPER tag, does not appear in the keeper list) and the clock **does** restart, as it should for a live pick.
6. Enter a brand-new pick into an empty cell via the form. It saves as a normal pick, and the clock restarts.

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "Preserve a pick's keeper source when it's edited"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `opts.onPickClick`, `data-overall`, `role="button"`, `tabindex="0"` on filled cells | 1 |
| Delegated listener (click + Enter/Space) | 1 |
| `editPick()` — `goToPick` + scroll + focus | 1 |
| `opts.editingOverall` and the `editing` class | 2 |
| Call sites in `loadAll`, `togglePickClock`, `resetPickClock` | 2 |
| `.pick-cell.clickable` cursor/hover/`:focus-visible`; `.pick-cell.editing` outline | 1, 2 |
| Empty cells inert | 1 (step 7.4) |
| `draft.html` unchanged | 1 (step 7.7), 2 (step 6.8) |
| Keeper `source` preserved, clock untouched | 3 |

**Deviation from the spec worth noting:** the spec says the three call sites pass an inline `opts` object. The plan introduces `refreshBoard()` instead, because `editingOverall` also has to update when the form moves without a realtime event (Task 2, step 4) — that would otherwise be a fourth inline copy of the same object. Same behaviour, one definition.

**Type consistency:** `onPickClick`, `editingOverall`, `wirePickCellClicks`, `refreshBoard`, `editPick`, `loadedPickSource` are each spelled identically everywhere they appear. `opts.editingOverall` is compared with `===` against `overall`, which is a `Number` in `renderBoard` and a `Number` from `refreshBoard` — no string/number mismatch.
