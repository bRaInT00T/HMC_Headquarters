// Global search across data/rules.json and data/settings.json.
// Included on every page (via the shared .site-header search box). Builds an
// in-memory index on load, filters it as-you-type, and links results to
// rules.html/settings.html with a #hash that highlightHash() scrolls to.
(function () {
  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  let searchIndex = [];

  async function buildIndex() {
    const [rulesRes, settingsRes] = await Promise.all([
      fetch("data/rules.json?" + Date.now()),
      fetch("data/settings.json?" + Date.now()),
    ]);
    const rules = await rulesRes.json();
    const settings = await settingsRes.json();

    const entries = [];

    (rules.sections || []).forEach((section, s) => {
      entries.push({ page: "rules.html", hash: `rules-sec-${s}`, breadcrumb: "Rules", text: section.title });
      (section.items || []).forEach((item, i) => {
        entries.push({ page: "rules.html", hash: `rules-item-${s}-${i}`, breadcrumb: section.title, text: item });
      });
    });

    const settingsTables = [
      { key: "mechanics", label: "League Mechanics", rows: settings.leagueMechanics || [] },
      { key: "offense", label: "Scoring — Offense", rows: (settings.scoring && settings.scoring.offense) || [] },
      { key: "kickers", label: "Scoring — Kickers", rows: (settings.scoring && settings.scoring.kickers) || [] },
      { key: "dst", label: "Scoring — Defense/Special Teams", rows: (settings.scoring && settings.scoring.defenseSpecialTeams) || [] },
    ];
    settingsTables.forEach((table) => {
      table.rows.forEach((row, r) => {
        const label = row.label || row.stat || "";
        entries.push({
          page: "settings.html",
          hash: `settings-row-${table.key}-${r}`,
          breadcrumb: table.label,
          text: `${label}: ${row.value || ""}`,
        });
      });
    });

    searchIndex = entries;
  }

  function renderResults(container, matches) {
    if (!matches.length) {
      container.innerHTML = `<div class="search-empty">No matches</div>`;
      container.hidden = false;
      return;
    }
    container.innerHTML = matches
      .map(
        (m) => `<a class="search-result" href="${m.page}#${m.hash}">
          <span class="search-breadcrumb">${escHtml(m.breadcrumb)}</span>
          <span class="search-text">${escHtml(m.text)}</span>
        </a>`
      )
      .join("");
    container.hidden = false;
  }

  function wireSearchBox() {
    const input = document.getElementById("global-search");
    const results = document.getElementById("search-results");
    if (!input || !results) return;

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      const matches = searchIndex
        .filter((e) => e.text.toLowerCase().includes(q) || e.breadcrumb.toLowerCase().includes(q))
        .slice(0, 8);
      renderResults(results, matches);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        results.hidden = true;
        input.blur();
      }
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !results.contains(e.target)) {
        results.hidden = true;
      }
    });
  }

  function highlightHash() {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    const el = document.getElementById(hash);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("search-highlight");
    setTimeout(() => el.classList.remove("search-highlight"), 2000);
  }
  window.highlightHash = highlightHash;
  window.addEventListener("hashchange", highlightHash);

  wireSearchBox();
  buildIndex().catch((err) => console.error("Search index failed to load:", err));
})();
