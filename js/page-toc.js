// Right-gutter table of contents for the long commissioner pages.
//
// Built from the page rather than hand-maintained: every `section[id]` under
// the root contributes its <h2> as a top-level entry, and any `h3[id]` inside
// it becomes a nested one. Entries are ordinary `#id` links, so any row is
// linkable and shareable; the panel tracks the scroll position, expands the
// section you're in, and remembers whether you left it collapsed.
//
// Call it after the content it describes is in the DOM (on the admin pages,
// that's once the password gate has been cleared).

const TOC_COLLAPSED_KEY = "hmc-toc-collapsed";
// How far below the viewport top a heading counts as "the section you're in" —
// roughly the sticky header plus a little breathing room.
const TOC_ACTIVE_OFFSET = 96;

function initPageToc({ mountId = "page-toc", root = "main" } = {}) {
  const mount = document.getElementById(mountId);
  const rootEl = document.querySelector(root);
  if (!mount || !rootEl) return null;

  const sections = Array.from(rootEl.querySelectorAll("section[id]"))
    .map((section) => {
      const heading = section.querySelector("h2");
      if (!heading) return null;
      const children = Array.from(section.querySelectorAll("h3[id]")).map((h3) => ({
        id: h3.id,
        text: tocLabel(h3.textContent),
        el: h3
      }));
      return { id: section.id, text: tocLabel(heading.textContent), el: section, children };
    })
    .filter(Boolean);

  if (!sections.length) return null;

  mount.hidden = false;
  mount.innerHTML = `
    <div class="toc-head">
      <span class="toc-title">On this page</span>
      <button type="button" class="icon-btn small" id="toc-collapse"
              aria-controls="toc-list" aria-label="Collapse table of contents"
              title="Collapse table of contents">▾</button>
    </div>
    <ol class="toc-list" id="toc-list">
      ${sections
        .map(
          (s, i) => `<li class="toc-item" data-toc-id="${escapeHtml(s.id)}">
            <div class="toc-row">
              ${
                s.children.length
                  ? `<button type="button" class="toc-twisty" aria-expanded="false"
                             aria-controls="toc-sub-${i}" aria-label="Show subsections of ${escapeHtml(s.text)}">▸</button>`
                  : `<span class="toc-twisty toc-twisty-empty" aria-hidden="true"></span>`
              }
              <a href="#${escapeHtml(s.id)}">${escapeHtml(s.text)}</a>
            </div>
            ${
              s.children.length
                ? `<ol class="toc-sub" id="toc-sub-${i}" hidden>${s.children
                    .map(
                      (c) => `<li class="toc-item toc-item-sub" data-toc-id="${escapeHtml(c.id)}">
                        <a href="#${escapeHtml(c.id)}">${escapeHtml(c.text)}</a>
                      </li>`
                    )
                    .join("")}</ol>`
                : ""
            }
          </li>`
        )
        .join("")}
    </ol>`;

  const list = mount.querySelector("#toc-list");
  const collapseBtn = mount.querySelector("#toc-collapse");

  // ── Collapsing ──────────────────────────────────────────────────────────
  function setCollapsed(collapsed) {
    mount.classList.toggle("collapsed", collapsed);
    list.hidden = collapsed;
    collapseBtn.textContent = collapsed ? "▸" : "▾";
    collapseBtn.setAttribute("aria-expanded", String(!collapsed));
    const verb = collapsed ? "Expand" : "Collapse";
    collapseBtn.setAttribute("aria-label", `${verb} table of contents`);
    collapseBtn.title = `${verb} table of contents`;
    localStorage.setItem(TOC_COLLAPSED_KEY, collapsed ? "1" : "0");
  }
  // Default open on a wide screen, closed where the panel sits above the
  // content instead of beside it — but a stored preference wins either way.
  const stored = localStorage.getItem(TOC_COLLAPSED_KEY);
  setCollapsed(stored === null ? window.matchMedia("(max-width: 1100px)").matches : stored === "1");
  collapseBtn.addEventListener("click", () => setCollapsed(!mount.classList.contains("collapsed")));

  // Per-section twisties. Once someone opens or closes one by hand, the
  // scroll-follow below stops rearranging that section under them.
  const pinned = new Set();
  function setExpanded(item, expanded) {
    const sub = item.querySelector(".toc-sub");
    const twisty = item.querySelector(".toc-twisty");
    if (!sub || !twisty) return;
    sub.hidden = !expanded;
    twisty.textContent = expanded ? "▾" : "▸";
    twisty.setAttribute("aria-expanded", String(expanded));
  }
  list.querySelectorAll(".toc-item > .toc-row > .toc-twisty").forEach((twisty) => {
    if (!twisty.matches("button")) return;
    twisty.addEventListener("click", () => {
      const item = twisty.closest(".toc-item");
      pinned.add(item.dataset.tocId);
      setExpanded(item, twisty.getAttribute("aria-expanded") !== "true");
    });
  });

  // ── Scroll following ────────────────────────────────────────────────────
  // Flattened in document order, so "the heading you're under" is just the
  // last one whose top has passed the offset.
  const targets = [];
  sections.forEach((s) => {
    targets.push({ id: s.id, el: s.el, parentId: null });
    s.children.forEach((c) => targets.push({ id: c.id, el: c.el, parentId: s.id }));
  });

  let activeId = null;
  function highlight() {
    let current = targets[0];
    for (const t of targets) {
      if (t.el.getBoundingClientRect().top <= TOC_ACTIVE_OFFSET) current = t;
    }
    // The last section is usually too short to ever reach the offset line;
    // once the page is scrolled to the bottom, it's the one being read.
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
      current = targets[targets.length - 1];
    }
    if (!current || current.id === activeId) return;
    activeId = current.id;

    list.querySelectorAll(".toc-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.tocId === activeId);
    });
    // Open the section being read (unless its twisty was set by hand), and
    // keep the active row visible without scrolling the page itself.
    const parentId = current.parentId || current.id;
    list.querySelectorAll(".toc-item[data-toc-id]").forEach((item) => {
      if (!item.querySelector(".toc-sub") || pinned.has(item.dataset.tocId)) return;
      setExpanded(item, item.dataset.tocId === parentId);
    });
    const activeRow = list.querySelector(`.toc-item[data-toc-id="${CSS.escape(activeId)}"]`);
    if (activeRow) scrollRowIntoView(list, activeRow);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      highlight();
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  highlight();

  // Clicking a row navigates by hash (so the URL stays copyable) and, on the
  // narrow layout where the panel sits above the content, gets out of the way.
  list.addEventListener("click", (e) => {
    if (!e.target.closest("a")) return;
    if (window.matchMedia("(max-width: 1100px)").matches) setCollapsed(true);
  });

  // A link into a section of a gated page can only be honoured once the gate
  // is cleared and this panel is built — so re-apply the hash here.
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }

  return { highlight, setCollapsed };
}

// Section headings are numbered ("4. Draft Order Setup"); the number is the
// list's job, not the label's. Also flattens the whitespace that HTML
// indentation leaves in textContent.
function tocLabel(text) {
  return String(text || "").replace(/\s+/g, " ").trim().replace(/^\d+\.\s*/, "");
}

// scrollIntoView() would scroll every scrollable ancestor, including the page
// — the one thing a scroll-follow panel must never do.
function scrollRowIntoView(list, row) {
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  if (rowRect.top < listRect.top) {
    list.scrollTop -= listRect.top - rowRect.top + 8;
  } else if (rowRect.bottom > listRect.bottom) {
    list.scrollTop += rowRect.bottom - listRect.bottom + 8;
  }
}
