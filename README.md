# HMC Fantasy Football Site

Static site for The Handsome Men's Club fantasy football league: rules, settings, and a live public draft board.
No build step — plain HTML/CSS/JS, hosted free on GitHub Pages.

## How it works

- **Rules & Settings** (`rules.html`, `settings.html`) render from `data/rules.json` and `data/settings.json`.
  Edit those files directly (in GitHub's web UI or a local git client) and commit with a clear message —
  the "Version History" panel on each page pulls that file's commit history straight from GitHub
  (who, when, and what changed) automatically. No separate changelog to maintain.
- **Draft Board** (`draft.html`) is public and read-only. It polls `data/draft-config.json` (team/owner order)
  and `data/draft-picks.json` (picks made so far) every 15 seconds.
- **Admin** (`admin.html`) is where the commissioner sets the draft order and enters picks live during the
  draft. Every save is a real git commit to `data/draft-config.json` / `data/draft-picks.json`, made through
  the GitHub Contents API using a personal access token you provide.

## One-time setup

1. **Create a GitHub repo.**
   - Go to github.com → New repository → name it something like `hmc-ffl-site` → Public (required for
     free GitHub Pages *and* for the version-history/live-board pages to read commit data anonymously).
2. **Push this folder to it.**
   ```
   cd site
   git remote add origin https://github.com/<you>/<repo>.git
   git branch -M main
   git push -u origin main
   ```
   (This folder is already a git repo with an initial commit — see the git log for the starting point.)
3. **Enable GitHub Pages.**
   - Repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main` / `(root)` → Save.
   - Your site will be live at `https://<you>.github.io/<repo>/` within a minute or two.
4. **Point the site at your repo.**
   - Edit `js/config.js`, set `GITHUB_OWNER` and `GITHUB_REPO` (and `GITHUB_BRANCH` if not `main`).
   - Commit and push. This is what makes the Version History panels and the draft board's polling work.
5. **Create an admin token for draft day.**
   - GitHub → Settings (your account) → Developer settings → Personal access tokens → Fine-grained tokens →
     Generate new token.
   - Scope it to **only this repository**, with **Contents: Read and write** permission, nothing else.
   - Set a short expiration (e.g. covers just draft weekend) and regenerate a fresh one next season.
   - Open `admin.html`, log in with the admin password (change `ADMIN_PASSWORD` in `admin.html` before your
     draft — the default is a placeholder), paste the token in, click "Save Token." It's stored only in that
     browser's local storage, never in the site's source.

## Before the draft

- On `admin.html`, fill in **Draft Order** (owner per slot 1-12) once it's drawn — save it. `draft.html` will
  then show real names instead of "TBD" and correctly compute who's on the clock.
- Default is a 12-team, 16-round snake draft (`data/draft-config.json`) — edit `rounds` there if that changes.

## During the draft

- On `admin.html`, enter each pick (round, team, player, position, NFL team) as it happens. The public
  `draft.html` page picks it up on its next 15-second refresh — no need to tell people to hit refresh.
- "Undo Last Pick" removes the most recent pick (also a commit, so the correction is in the history too).

## Notes / things to double-check

- `data/settings.json` was captured from a Yahoo settings screenshot whose Trade End Date showed a stale
  year — confirm and correct that field (and anything else Yahoo-specific) each season.
- The repo needs to stay **public** for the anonymous GitHub API calls (commit history + admin's read calls)
  to work without every visitor needing a token. If you'd rather keep it private, the Version History panels
  and admin page would need a small authenticated proxy instead — ask if you want that swapped in.
