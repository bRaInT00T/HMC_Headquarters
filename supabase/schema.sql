-- HMC Fantasy Football — Supabase schema
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query).

-- ── draft_config: one row (id=1) holding this season's draft order/format ──
create table if not exists draft_config (
  id int primary key default 1,
  season text not null default '2026',
  draft_date text not null default 'TBD – fourth weekend of August',
  format text not null default 'Snake',
  rounds int not null default 16,
  teams jsonb not null default '[]'::jsonb,
  -- Picks that changed hands. Each entry is
  --   {"round":3,"fromSlot":4,"toSlot":10}
  -- meaning: the round-3 pick sitting in slot 4's column is now made by slot 10.
  -- The pick keeps its position in the snake order — only who makes it changes
  -- (league rule: "you will not have that pick… the team you traded with will
  -- receive an additional pick in that round").
  traded_picks jsonb not null default '[]'::jsonb,
  -- The pick clock, so every viewer agrees and a reload doesn't restart it:
  --   {"startedAt":"…","pausedAt":null}
  -- startedAt is when the current team went on the clock; pausedAt freezes the
  -- countdown at whatever was left. Empty {} means "derive it from the last
  -- pick's entered_at", which is how it behaved before pause/reset existed.
  clock_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint draft_config_singleton check (id = 1)
);

-- Existing projects: add new columns without touching the row's other values.
alter table draft_config add column if not exists traded_picks jsonb not null default '[]'::jsonb;
alter table draft_config add column if not exists clock_state jsonb not null default '{}'::jsonb;

insert into draft_config (id, teams)
values (1, '[
  {"slot":1,"owner":"TBD"},{"slot":2,"owner":"TBD"},{"slot":3,"owner":"TBD"},
  {"slot":4,"owner":"TBD"},{"slot":5,"owner":"TBD"},{"slot":6,"owner":"TBD"},
  {"slot":7,"owner":"TBD"},{"slot":8,"owner":"TBD"},{"slot":9,"owner":"TBD"},
  {"slot":10,"owner":"TBD"},{"slot":11,"owner":"TBD"},{"slot":12,"owner":"TBD"}
]'::jsonb)
on conflict (id) do nothing;

-- ── draft_picks: one row per pick, keyed by overall pick number ──
create table if not exists draft_picks (
  overall_pick int primary key,
  round int not null,
  slot int not null,
  team text not null,
  player text not null,
  position text,
  nfl_team text,
  -- 'manual' | 'yahoo' | 'keeper'. Keepers are ordinary pick rows written
  -- before draft day at the round the league rules assign them, so they occupy
  -- their slot on the board and are skipped by the on-the-clock logic.
  source text not null default 'manual',
  entered_at timestamptz not null default now()
);

-- ── nfl_players: local cache of balldontlie's NFL player list, synced from
-- admin.html's "Sync Players" button — powers the manual pick-entry
-- autocomplete without hitting an external API on every keystroke ──
create table if not exists nfl_players (
  id bigint primary key,
  first_name text not null,
  last_name text not null,
  full_name text not null,
  position text,
  team text,
  jersey_number text,
  updated_at timestamptz not null default now()
);

-- ── yahoo_tokens: single row (id=1), server-only, never exposed to anon ──
create table if not exists yahoo_tokens (
  id int primary key default 1,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  constraint yahoo_tokens_singleton check (id = 1)
);

-- ── Row Level Security ──
alter table draft_config enable row level security;
alter table draft_picks enable row level security;
alter table nfl_players enable row level security;
alter table yahoo_tokens enable row level security;

-- Public (anon key, used by draft.html/admin.html in the browser) can read
-- draft_config and draft_picks. No insert/update/delete policies are defined
-- for anon, so writes are blocked unless made with the service role key
-- (which Vercel's serverless functions use, and which bypasses RLS).
drop policy if exists "public read draft_config" on draft_config;
create policy "public read draft_config" on draft_config for select using (true);

drop policy if exists "public read draft_picks" on draft_picks;
create policy "public read draft_picks" on draft_picks for select using (true);

drop policy if exists "public read nfl_players" on nfl_players;
create policy "public read nfl_players" on nfl_players for select using (true);

-- yahoo_tokens gets zero policies — no anon access at all, in either
-- direction. Only the service role key (server-side only) can touch it.

-- ── Realtime: let draft.html subscribe to live pick updates ──
-- Adding a table that's already in the publication raises 42710, and the
-- Supabase SQL Editor runs this file as a single transaction — so a bare
-- `alter publication … add table` would roll back everything above it on a
-- re-run. Guarded so this file stays safe to run more than once.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_picks'
  ) then
    alter publication supabase_realtime add table draft_picks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_config'
  ) then
    alter publication supabase_realtime add table draft_config;
  end if;
exception
  when undefined_object then
    -- No supabase_realtime publication in this project yet. Enable Realtime for
    -- draft_picks/draft_config from the Table Editor UI instead
    -- (Database → Replication → supabase_realtime).
    raise notice 'supabase_realtime publication not found — enable Realtime from the dashboard.';
end $$;

-- ── Mock draft ────────────────────────────────────────────────────────────
-- A throwaway rehearsal the league can run before draft day: same board, same
-- announcement, entirely separate rows. Nothing here ever touches draft_picks
-- or draft_config, so a mock can be started, reset and abandoned at any time
-- without risk to the real draft.

-- Singleton (id=1) saying whether a mock is running, and holding its own pick
-- clock — the real draft_config.clock_state must not be disturbed by a mock.
create table if not exists mock_draft_state (
  id int primary key default 1,
  active boolean not null default false,
  -- Same shape as draft_config.clock_state: {"startedAt":"…","pausedAt":null}
  clock_state jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint mock_draft_state_singleton check (id = 1)
);

insert into mock_draft_state (id) values (1) on conflict (id) do nothing;

-- Same columns as draft_picks, minus 'keeper' handling — a mock starts from an
-- empty board every time.
create table if not exists mock_draft_picks (
  overall_pick int primary key,
  round int not null,
  slot int not null,
  team text not null,
  player text not null,
  position text,
  nfl_team text,
  entered_at timestamptz not null default now()
);

alter table mock_draft_state enable row level security;
alter table mock_draft_picks enable row level security;

-- Read-only for the anon key, exactly like the real tables: the browser reads
-- the mock board directly, but every write still goes through /api/mock/* with
-- the service role key. Those routes skip the admin-password check on purpose
-- (any league member can run a mock) — they are the only unauthenticated write
-- routes in the project, and they can only reach these two tables.
drop policy if exists "public read mock_draft_state" on mock_draft_state;
create policy "public read mock_draft_state" on mock_draft_state for select using (true);

drop policy if exists "public read mock_draft_picks" on mock_draft_picks;
create policy "public read mock_draft_picks" on mock_draft_picks for select using (true);

-- Realtime, so every viewer's mock board updates the moment a pick lands —
-- same guarded pattern as the real tables above.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mock_draft_picks'
  ) then
    alter publication supabase_realtime add table mock_draft_picks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mock_draft_state'
  ) then
    alter publication supabase_realtime add table mock_draft_state;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not found — enable Realtime from the dashboard.';
end $$;
