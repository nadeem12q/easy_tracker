create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  color text not null default 'var(--mint)' check (char_length(color) <= 40),
  category text not null default 'custom' check (char_length(btrim(category)) between 1 and 40),
  is_binary boolean not null default true,
  position integer not null default 0 check (position >= 0),
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table if not exists public.daily_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date date not null,
  sleep_time time,
  wake_time time,
  sleep_duration_minutes integer check (sleep_duration_minutes is null or sleep_duration_minutes between 0 and 1440),
  sleep_duration_label text check (sleep_duration_label is null or char_length(sleep_duration_label) <= 32),
  sleep_quality integer not null default 0 check (sleep_quality between 0 and 5),
  sleep_quality_note text not null default '' check (char_length(sleep_quality_note) <= 1000),
  screen_time text not null default '' check (char_length(screen_time) <= 32),
  mood_key text not null default '' check (char_length(mood_key) <= 40),
  mood_label text not null default '' check (char_length(mood_label) <= 40),
  mood_emoji text not null default '' check (char_length(mood_emoji) <= 16),
  day_rating integer not null default 0 check (day_rating between 0 and 5),
  best_moment text not null default '' check (char_length(best_moment) <= 4000),
  improved_today text not null default '' check (char_length(improved_today) <= 4000),
  gratitude text not null default '' check (char_length(gratitude) <= 4000),
  review text not null default '' check (char_length(review) <= 4000),
  goals_achieved text not null default '' check (char_length(goals_achieved) <= 4000),
  still_working_on text not null default '' check (char_length(still_working_on) <= 4000),
  focus_for_tomorrow text not null default '' check (char_length(focus_for_tomorrow) <= 4000),
  intentions_for_tomorrow text not null default '' check (char_length(intentions_for_tomorrow) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table if not exists public.daily_habit_logs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.daily_entries (id) on delete cascade,
  habit_id uuid not null references public.user_habits (id) on delete cascade,
  done boolean not null default false,
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, habit_id)
);

create table if not exists public.mcp_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_name text not null check (char_length(btrim(client_name)) between 1 and 120),
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  token_prefix text not null check (char_length(token_prefix) between 6 and 16),
  can_write boolean not null default true,
  can_analyze boolean not null default true,
  expires_at timestamptz not null default (now() + interval '90 days'),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mcp_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_id uuid references public.mcp_api_tokens (id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  client_name text,
  success boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists user_habits_user_id_archived_position_idx
on public.user_habits (user_id, is_archived, position);

create index if not exists daily_entries_user_id_entry_date_idx
on public.daily_entries (user_id, entry_date desc);

create index if not exists daily_habit_logs_entry_id_habit_id_idx
on public.daily_habit_logs (entry_id, habit_id);

create index if not exists mcp_api_tokens_user_id_expires_idx
on public.mcp_api_tokens (user_id, revoked_at, expires_at desc);

create index if not exists mcp_audit_logs_user_id_created_at_idx
on public.mcp_audit_logs (user_id, created_at desc);

create or replace function public.seed_default_habits(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_habits (user_id, name, slug, color, category, is_binary, position)
  values
    (target_user_id, '3 Meals', '3-meals', 'var(--lavender)', 'nutrition', true, 0),
    (target_user_id, 'Workout', 'workout', 'var(--lavender)', 'health', true, 1),
    (target_user_id, 'Read', 'read', 'var(--sand)', 'learning', true, 2),
    (target_user_id, 'Fajar', 'fajar', 'var(--sand)', 'spiritual', true, 3),
    (target_user_id, 'Zohar', 'zohar', 'var(--rose)', 'spiritual', true, 4),
    (target_user_id, 'Asar', 'asar', 'var(--rose)', 'spiritual', true, 5),
    (target_user_id, 'Magrib', 'magrib', 'var(--violet)', 'spiritual', true, 6),
    (target_user_id, 'Isha', 'isha', 'var(--violet)', 'spiritual', true, 7),
    (target_user_id, 'Quran', 'quran', 'var(--taupe)', 'spiritual', true, 8),
    (target_user_id, 'Dua T&A', 'dua-t-a', 'var(--taupe)', 'spiritual', true, 9),
    (target_user_id, 'Less Talk', 'less-talk', 'var(--mint)', 'character', true, 10),
    (target_user_id, 'Kind Response', 'kind-response', 'var(--mint)', 'character', true, 11),
    (target_user_id, 'Control Anger', 'control-anger', 'var(--lilac)', 'character', true, 12),
    (target_user_id, 'Silent Sitting', 'silent-sitting', 'var(--lilac)', 'mindfulness', true, 13),
    (target_user_id, 'Journalizing', 'journalizing', 'var(--peach)', 'reflection', true, 14)
  on conflict (user_id, slug) do nothing;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  perform public.seed_default_habits(new.id);
  return new;
end;
$$;

select public.seed_default_habits(id)
from auth.users;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_user_habits_updated_at on public.user_habits;
create trigger set_user_habits_updated_at
before update on public.user_habits
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_entries_updated_at on public.daily_entries;
create trigger set_daily_entries_updated_at
before update on public.daily_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_habit_logs_updated_at on public.daily_habit_logs;
create trigger set_daily_habit_logs_updated_at
before update on public.daily_habit_logs
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_habits enable row level security;
alter table public.daily_entries enable row level security;
alter table public.daily_habit_logs enable row level security;
alter table public.mcp_sessions enable row level security;
alter table public.mcp_api_tokens enable row level security;
alter table public.mcp_audit_logs enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "user_habits_select_own"
on public.user_habits
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy "user_habits_insert_own"
on public.user_habits
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "user_habits_update_own"
on public.user_habits
for update
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "user_habits_delete_own"
on public.user_habits
for delete
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy "daily_entries_select_own"
on public.daily_entries
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy "daily_entries_insert_own"
on public.daily_entries
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "daily_entries_update_own"
on public.daily_entries
for update
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "daily_entries_delete_own"
on public.daily_entries
for delete
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy "daily_habit_logs_select_own"
on public.daily_habit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.daily_entries e
    where e.id = daily_habit_logs.entry_id
      and e.user_id = auth.uid()
  )
);

create policy "daily_habit_logs_insert_own"
on public.daily_habit_logs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.daily_entries e
    where e.id = daily_habit_logs.entry_id
      and e.user_id = auth.uid()
  )
);

create policy "daily_habit_logs_update_own"
on public.daily_habit_logs
for update
to authenticated
using (
  exists (
    select 1
    from public.daily_entries e
    where e.id = daily_habit_logs.entry_id
      and e.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.daily_entries e
    where e.id = daily_habit_logs.entry_id
      and e.user_id = auth.uid()
  )
);

create policy "daily_habit_logs_delete_own"
on public.daily_habit_logs
for delete
to authenticated
using (
  exists (
    select 1
    from public.daily_entries e
    where e.id = daily_habit_logs.entry_id
      and e.user_id = auth.uid()
  )
);

create policy "mcp_sessions_select_own"
on public.mcp_sessions
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy "mcp_sessions_insert_own"
on public.mcp_sessions
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "mcp_sessions_update_own"
on public.mcp_sessions
for update
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "mcp_api_tokens_select_own"
on public.mcp_api_tokens
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy "mcp_api_tokens_insert_own"
on public.mcp_api_tokens
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "mcp_api_tokens_update_own"
on public.mcp_api_tokens
for update
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "mcp_api_tokens_delete_own"
on public.mcp_api_tokens
for delete
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy "mcp_audit_logs_select_own"
on public.mcp_audit_logs
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.user_habits to authenticated;
grant select, insert, update, delete on public.daily_entries to authenticated;
grant select, insert, update, delete on public.daily_habit_logs to authenticated;
grant select, insert, update, delete on public.mcp_sessions to authenticated;
grant select, insert, update, delete on public.mcp_api_tokens to authenticated;
grant select on public.mcp_audit_logs to authenticated;

revoke all on function public.handle_new_user() from anon, authenticated, public;
revoke all on function public.set_updated_at() from anon, authenticated, public;
revoke all on function public.seed_default_habits(uuid) from anon, authenticated, public;
