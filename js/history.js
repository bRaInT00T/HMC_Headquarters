// Renders GitHub commit history (who/when/what) for a given data file
// into a .history-panel container. Falls back to a helpful message if
// SITE_CONFIG hasn't been filled in yet, or if the repo is still private
// (commit history for private repos isn't visible to anonymous fetches).
async function renderHistory(containerId, filePath) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = window.SITE_CONFIG || {};
  if (!GITHUB_OWNER || !GITHUB_REPO) {
    el.innerHTML = `<p style="color:var(--text-dim);font-size:0.85rem;">
      Version history will appear here once this site is connected to its GitHub repo.
      Set GITHUB_OWNER / GITHUB_REPO in <code>js/config.js</code>.
    </p>`;
    return;
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?path=${encodeURIComponent(filePath)}&sha=${GITHUB_BRANCH || "main"}&per_page=15`;

  try {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const commits = await res.json();

    if (!Array.isArray(commits) || commits.length === 0) {
      el.innerHTML = `<p style="color:var(--text-dim);font-size:0.85rem;">No commit history found yet for this file.</p>`;
      return;
    }

    el.innerHTML = commits
      .map((c) => {
        const author = c.commit.author?.name || "Unknown";
        const date = new Date(c.commit.author?.date || Date.now());
        const dateStr = date.toLocaleString(undefined, {
          year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        });
        const msg = (c.commit.message || "").split("\n")[0];
        const shortSha = c.sha.slice(0, 7);
        return `<div class="history-item">
          <div class="msg">${escapeHtml(msg)}</div>
          <div class="meta">${escapeHtml(author)} · ${dateStr} · <a href="${c.html_url}" target="_blank" rel="noopener">${shortSha}</a></div>
        </div>`;
      })
      .join("");
  } catch (err) {
    el.innerHTML = `<p style="color:var(--text-dim);font-size:0.85rem;">
      Couldn't load version history (${escapeHtml(err.message)}). If this repo is private,
      commit history isn't visible to anonymous visitors — either make the repo public
      or fetch this with an authenticated request.
    </p>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
