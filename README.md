# HMC Fantasy Football Site

Rules, settings, and a live public draft board for The Handsome Men's Club. Rules/settings are plain
HTML/JS reading from git-tracked JSON (version history = git commit history, via GitHub's API). The draft
board runs on Supabase (Postgres + Realtime) and Vercel (static hosting + serverless functions), with
picks synced automatically from Yahoo Fantasy Sports during the live draft.

## Architecture

- **Rules & Settings** (`rules.html`, `settings.html`) — unchanged from the original build. They render
  `data/rules.json` / `data/settings.json` and show that file's GitHub commit history (who/when/what) via
  the GitHub API. Still just: edit the JSON, commit with a clear message, done.
- **Draft Board** (`draft.html`) — public, read-only, subscribed to Supabase Realtime. Updates the instant
  a row changes in the `draft_picks` table — no polling.
- **Admin** (`admin.html`) — password-gated (checked **server-side** now, via `ADMIN_PASSWORD`). Lets you:
  connect a Yahoo account, trigger a sync (or toggle a 20-second auto-sync loop for draft day), set the
  draft order, and manually add/undo picks as a fallback.
- **Yahoo sync** (`/api/yahoo/*`) — three-legged OAuth against Yahoo's Fantasy Sports API. Tokens are
  stored in Supabase (`yahoo_tokens`, server-only). `/api/yahoo/sync` pulls `draftresults`, resolves team
  and player names, and upserts rows into `draft_picks` — which is what fans out to everyone watching
  `draft.html` in real time.

## One-time setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty for this).
2. Project → SQL Editor → paste in `supabase/schema.sql` → Run. This creates `draft_config`,
   `draft_picks`, `yahoo_tokens`, sets Row Level Security (public read on the first two, zero access to
   the token table), and turns on Realtime for `draft_picks`/`draft_config`.
   - If the `alter publication supabase_realtime add table ...` lines error because Realtime is managed
     differently in your project, just enable it manually: Database → Replication → toggle on for
     `draft_picks` and `draft_config`.
3. Project Settings → API — note down the **Project URL**, the **anon public key**, and the
   **service_role key** (keep the service_role key secret; it bypasses RLS entirely).

### 2. GitHub

Same as before — push this repo to GitHub (public, so the Version History panels and Vercel's git
integration both work without extra auth):
```
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

### 3. Yahoo Developer app

You already have Yahoo's API approval — from the Yahoo Developer Network, create/confirm an app and note:
- **Client ID** and **Client Secret**
- Set its **Redirect URI** to `https://<your-vercel-domain>/api/yahoo/callback` (you'll know the exact
  domain after step 4 — Vercel gives you one immediately, e.g. `hmc-ffl-site.vercel.app`, and you can come
  back and update the Yahoo app's redirect URI once you have it).
- Find your **league key** from your Yahoo league's URL or the League Settings page — format is
  `{game_key}.l.{league_id}`, e.g. `461.l.123456`.

### 4. Vercel

1. [vercel.com](https://vercel.com) → New Project → import this GitHub repo. No build settings needed —
   it's static files plus `/api` functions, Vercel detects both automatically.
2. Project → Settings → Environment Variables — add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | from Supabase step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase step 1 (server-only — never appears in any file in this repo) |
   | `YAHOO_CLIENT_ID` | from Yahoo step 3 |
   | `YAHOO_CLIENT_SECRET` | from Yahoo step 3 |
   | `YAHOO_REDIRECT_URI` | `https://<your-vercel-domain>/api/yahoo/callback` |
   | `YAHOO_LEAGUE_KEY` | from Yahoo step 3 |
   | `ADMIN_PASSWORD` | pick something for the commissioner(s) — this now does real access control |

3. Redeploy after adding env vars (Vercel doesn't hot-reload them into an existing deployment).

### 5. Point the site at Supabase + GitHub

Edit `js/config.js`:
```js
window.SITE_CONFIG = {
  GITHUB_OWNER: "<you>",
  GITHUB_REPO: "<repo>",
  GITHUB_BRANCH: "main",
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "<anon public key from Supabase>"
};
```
Commit and push (this triggers a Vercel redeploy automatically once the GitHub integration is connected).

### 6. Connect Yahoo

Open `admin.html`, log in with `ADMIN_PASSWORD`, click **Connect Yahoo Account**. Approve access on
Yahoo's consent screen — you'll land back on admin.html with tokens saved in Supabase.

## Before the draft

- Draft order (owner per slot 1–12) is drawn from a hat each year. Yahoo sync backfills it automatically
  from round 1 once the draft starts — or set it by hand on `admin.html` beforehand.
- Default is a 12-team, 16-round snake draft (`draft_config.rounds` in Supabase). Change it via the
  `/api/draft-config/save` route if that's ever different.

## During the draft

- Click **Sync Now** on `admin.html` whenever you want the latest Yahoo picks pulled in, or check
  **Live sync every 20s** and leave that tab open — it polls `/api/yahoo/sync` on an interval from the
  browser (Vercel's free Hobby plan only allows cron jobs once a day, so this client-side loop is the
  practical way to get near-live syncing without a paid plan).
- `draft.html` needs zero interaction from anyone watching — Supabase Realtime pushes every change.
- **Manual entry** (section 3 on admin.html) is there as a fallback if Yahoo sync is down or you're not
  drafting inside Yahoo that year.

## Things worth knowing

- **Yahoo's JSON shape is unusual** — collections come back as `{"0": {...}, "1": {...}, "count": N}`
  instead of plain arrays, and records are sometimes arrays of single-key objects. `api/yahoo/sync.js` was
  written against Yahoo's documented format but hasn't been run against a live league yet — if it errors,
  check the Vercel function logs (Project → Deployments → Functions), which include Yahoo's raw error
  text, and it's likely a small field-path fix in that one file.
- **Rules/settings version control is unchanged** — still plain git commits to `data/rules.json` /
  `data/settings.json`, shown via the GitHub commit API. Moving the *draft board* to Supabase didn't touch
  this.
- **`data/draft-config.json` and `data/draft-picks.json`** are leftover from the original GitHub-Pages-only
  build and are no longer read by anything — safe to ignore or delete. `js/github-write.js` is similarly
  unused now (picks go through the Vercel API routes instead) but left in place in case you want to
  reference the old GitHub-PAT-based approach.
- `data/settings.json`'s Trade End Date field was captured from a stale Yahoo screenshot (showed 2022) —
  worth re-confirming from Yahoo for the current season.
