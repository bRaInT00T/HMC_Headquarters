// Minimal GitHub Contents API client used by admin.html to commit draft
// picks (and draft-config changes) straight to this repo. Every write is a
// real git commit — that's what gives us "who changed it / when / what"
// for the draft board, the same way it does for rules.json & settings.json.

function ghToken() {
  return localStorage.getItem("hmc_gh_token") || "";
}

function ghApiBase() {
  const { GITHUB_OWNER, GITHUB_REPO } = window.SITE_CONFIG || {};
  if (!GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error("GITHUB_OWNER / GITHUB_REPO not set in js/config.js yet.");
  }
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function ghGetFile(path) {
  const branch = (window.SITE_CONFIG && window.SITE_CONFIG.GITHUB_BRANCH) || "main";
  const res = await fetch(`${ghApiBase()}/contents/${path}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${ghToken()}`, Accept: "application/vnd.github+json" }
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { sha: json.sha, content: JSON.parse(b64DecodeUnicode(json.content)) };
}

async function ghPutFile(path, newContentObj, message) {
  const branch = (window.SITE_CONFIG && window.SITE_CONFIG.GITHUB_BRANCH) || "main";
  const { sha } = await ghGetFile(path);
  const body = {
    message,
    content: b64EncodeUnicode(JSON.stringify(newContentObj, null, 2) + "\n"),
    sha,
    branch
  };
  const res = await fetch(`${ghApiBase()}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${ghToken()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
