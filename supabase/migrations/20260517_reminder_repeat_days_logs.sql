alter table public.user_habits
  add column if not exists reminder_repeat_days smallint[] not null default array[0,1,2,3,4,5,6]::smallint[];

alter table public.user_habits
  drop constraint if exists user_habits_reminder_repeat_days_valid;

alter table public.user_habits
  add constraint user_habits_reminder_repeat_days_valid
  check (
    array_length(reminder_repeat_days, 1) is not null
    and reminder_repeat_days <@ array[0,1,2,3,4,5,6]::smallint[]
  );

create table if not exists public.reminder_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid not null references public.user_habits (id) on delete cascade,
  entry_date date not null,
  scheduled_for timestamptz,
  action text not null check (action in ('scheduled','fired','yes','no','later','missed','cancelled')),
  source text not null default 'app' check (char_length(source) <= 80),
  snooze_minutes integer check (snooze_minutes is null or snooze_minutes between 5 and 240),
  notification_id text check (notification_id is null or char_length(notification_id) <= 120),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reminder_logs_user_created_idx
on public.reminder_logs (user_id, created_at desc);

create index if not exists reminder_logs_user_entry_date_idx
on public.reminder_logs (user_id, entry_date desc);

create index if not exists reminder_logs_habit_entry_idx
on public.reminder_logs (habit_id, entry_date desc);

create index if not exists reminder_logs_action_idx
on public.reminder_logs (user_id, action, created_at desc);

alter table public.reminder_logs enable row level security;

drop policy if exists "reminder_logs_select_own" on public.reminder_logs;
create policy "reminder_logs_select_own"
on public.reminder_logs
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "reminder_logs_insert_own" on public.reminder_logs;
create policy "reminder_logs_insert_own"
on public.reminder_logs
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "reminder_logs_update_own" on public.reminder_logs;
create policy "reminder_logs_update_own"
on public.reminder_logs
for update
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

grant select, insert, update on public.reminder_logs to authenticated;

create or replace view public.reminder_log_view
with (security_invoker = true)
as
select
  logs.id,
  logs.user_id,
  logs.habit_id,
  habits.name as habit_name,
  logs.entry_date,
  logs.scheduled_for,
  logs.action,
  logs.source,
  logs.snooze_minutes,
  logs.notification_id,
  logs.detail,
  logs.created_at
from public.reminder_logs logs
join public.user_habits habits on habits.id = logs.habit_id;

grant select on public.reminder_log_view to authenticated;

create index if not exists user_habits_reminder_enabled_idx
on public.user_habits (user_id, reminder_enabled, reminder_time);
