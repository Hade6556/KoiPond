-- Koi Pond Supabase schema
-- Paste into Supabase → SQL editor → New query → Run.
-- Safe to re-run: every statement is `if not exists` / `create or replace` / `drop policy if exists`.

-- =========================================================
-- profiles (1:1 with auth.users)
-- =========================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text,
  company     text,
  stage       text default 'seed',
  language    text default 'en',          -- 'en' | 'lt' | 'mix'
  avatar_url  text,
  created_at  timestamptz default now()
);

-- Add language column for existing tables (idempotent)
alter table public.profiles add column if not exists language text default 'en';

-- Leaderboard opt-in + public handle. Off by default — users must opt in
-- explicitly from the Account page before any of their scores are shown to others.
alter table public.profiles add column if not exists display_handle      text;
alter table public.profiles add column if not exists country             text;          -- 2-char ISO code
alter table public.profiles add column if not exists leaderboard_opt_in  boolean default false;

-- =========================================================
-- pitch_sessions
-- =========================================================
create table if not exists public.pitch_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  scenario_id     text not null,
  scenario_title  text,
  transcript      text,
  audio_url       text,
  duration_sec    int,
  pitch_score     int,
  qa_score        int,
  total_score     int,
  weak_area       text,
  scorecard       jsonb,
  coach_feedback  text,
  created_at      timestamptz default now()
);

create index if not exists pitch_sessions_user_id_idx on public.pitch_sessions (user_id, created_at desc);

-- =========================================================
-- pitch_qa (Q&A turns inside a session)
-- =========================================================
create table if not exists public.pitch_qa (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.pitch_sessions on delete cascade,
  position           int not null,
  question           text not null,
  answer_transcript  text,
  scores             jsonb,
  feedback_note      text,
  created_at         timestamptz default now()
);

create index if not exists pitch_qa_session_id_idx on public.pitch_qa (session_id, position);

-- =========================================================
-- Row Level Security
-- =========================================================
alter table public.profiles       enable row level security;
alter table public.pitch_sessions enable row level security;
alter table public.pitch_qa       enable row level security;

drop policy if exists "profile read own"   on public.profiles;
drop policy if exists "profile insert own" on public.profiles;
drop policy if exists "profile update own" on public.profiles;

create policy "profile read own"   on public.profiles for select using (auth.uid() = id);
create policy "profile insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profile update own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "sessions read own"   on public.pitch_sessions;
drop policy if exists "sessions insert own" on public.pitch_sessions;
drop policy if exists "sessions update own" on public.pitch_sessions;
drop policy if exists "sessions delete own" on public.pitch_sessions;

create policy "sessions read own"   on public.pitch_sessions for select using (auth.uid() = user_id);
create policy "sessions insert own" on public.pitch_sessions for insert with check (auth.uid() = user_id);
create policy "sessions update own" on public.pitch_sessions for update using (auth.uid() = user_id);
create policy "sessions delete own" on public.pitch_sessions for delete using (auth.uid() = user_id);

drop policy if exists "qa read own"   on public.pitch_qa;
drop policy if exists "qa insert own" on public.pitch_qa;

create policy "qa read own" on public.pitch_qa for select using (
  exists (select 1 from public.pitch_sessions s where s.id = session_id and s.user_id = auth.uid())
);
create policy "qa insert own" on public.pitch_qa for insert with check (
  exists (select 1 from public.pitch_sessions s where s.id = session_id and s.user_id = auth.uid())
);

-- =========================================================
-- auto-create profile on new auth user
-- =========================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================
-- leaderboard_entries
--   One row per (user, scenario) — only the user's BEST submission for that
--   scenario is kept. New submissions overwrite the row when the new score is
--   strictly higher. This is the anti-grinding guarantee — the all-time board
--   shows your best, never your noisy averages.
--
--   Public read is gated by profiles.leaderboard_opt_in: a row is only visible
--   to other users if its owner has opted in. RLS enforces this.
-- =========================================================
create table if not exists public.leaderboard_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  session_id         uuid not null references public.pitch_sessions on delete cascade,
  scenario_id        text not null,
  scenario_title     text,
  pitch_score        int  not null,                 -- the Idea / coach score (0-100)
  qa_score           int,                           -- nullable when QA wasn't completed
  total_score        int  not null,                 -- the headline number used for ranking
  presence_score     int,                           -- Gemini score, nullable for audio-only mode
  verdict            text,                          -- 'Build it' | 'Maybe' | 'Skip it'
  duration_sec       int,
  transcript_hash    text,                          -- short hash, used for dup-detection
  created_at         timestamptz default now(),
  unique (user_id, scenario_id)
);

create index if not exists leaderboard_scenario_idx on public.leaderboard_entries (scenario_id, total_score desc, created_at desc);
create index if not exists leaderboard_career_idx   on public.leaderboard_entries (user_id, total_score desc);

alter table public.leaderboard_entries enable row level security;

-- Public read: only opted-in users' entries are visible to other users. Owners
-- can always read their own rows regardless of opt-in (so the Leaderboard page
-- can show "you're not opted in — toggle in Account to appear here").
drop policy if exists "lb read public" on public.leaderboard_entries;
drop policy if exists "lb read own"    on public.leaderboard_entries;
create policy "lb read public" on public.leaderboard_entries for select using (
  exists (select 1 from public.profiles p where p.id = user_id and p.leaderboard_opt_in = true)
);
create policy "lb read own" on public.leaderboard_entries for select using (auth.uid() = user_id);

-- Owners can upsert their own entry.
drop policy if exists "lb insert own" on public.leaderboard_entries;
drop policy if exists "lb update own" on public.leaderboard_entries;
drop policy if exists "lb delete own" on public.leaderboard_entries;
create policy "lb insert own" on public.leaderboard_entries for insert with check (auth.uid() = user_id);
create policy "lb update own" on public.leaderboard_entries for update using       (auth.uid() = user_id);
create policy "lb delete own" on public.leaderboard_entries for delete using       (auth.uid() = user_id);

-- Public-safe view of profiles (just the columns leaderboard rendering needs)
-- so the client can join leaderboard_entries → handle without exposing emails.
create or replace view public.public_profiles as
  select id, display_handle, country, leaderboard_opt_in, created_at
  from public.profiles
  where leaderboard_opt_in = true;

-- Anyone with anon key can read this view (it has zero PII beyond what the
-- user explicitly chose to publish).
grant select on public.public_profiles to anon, authenticated;

-- =========================================================
-- Locked-scenario enforcement
--   Mirrors the client-side isScenarioUnlocked() gate at the data layer so a
--   determined user can't bypass the UI lock by POSTing to leaderboard_entries
--   or pitch_sessions directly with the locked scenario_id.
--
--   Source of truth for unlock rules: lib/scenarios.js — keep this CASE in sync
--   when you add new locked scenarios.
-- =========================================================
create or replace function public.user_can_access_scenario(scenario text)
returns boolean
language sql
stable
as $$
  select case
    -- Eigirdas Žemaitis — only ISM students (@stud.ism.lt)
    when scenario = 'eigirdas-zemaitis' then
      coalesce(auth.jwt() ->> 'email', '') ilike '%@stud.ism.lt'
    -- All other scenarios are public
    else true
  end
$$;

-- Replace insert policies with versions that consult the gate
drop policy if exists "lb insert own" on public.leaderboard_entries;
create policy "lb insert own" on public.leaderboard_entries
  for insert with check (
    auth.uid() = user_id
    and public.user_can_access_scenario(scenario_id)
  );

drop policy if exists "sessions insert own" on public.pitch_sessions;
create policy "sessions insert own" on public.pitch_sessions
  for insert with check (
    auth.uid() = user_id
    and public.user_can_access_scenario(scenario_id)
  );
