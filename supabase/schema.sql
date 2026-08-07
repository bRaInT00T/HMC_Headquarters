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
  updated_at timestamptz not null default now(),
  constraint draft_config_singleton check (id = 1)
);

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
  source text not null default 'manual', -- 'manual' or 'yahoo'
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
-- If this errors because the publication already includes the table, or
-- doesn't exist yet, just enable "Realtime" for draft_picks from the Table
-- Editor UI instead (Database → Replication → supabase_realtime).
alter publication supabase_realtime add table draft_picks;
alter publication supabase_realtime add table draft_config;
