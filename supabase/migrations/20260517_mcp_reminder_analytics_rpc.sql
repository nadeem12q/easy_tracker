create or replace function public.mcp_token_user_id(input_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_token text;
  computed_token_hash text;
  token_user_id uuid;
begin
  raw_token := regexp_replace(coalesce(input_token, ''), '^mtk_', '');
  computed_token_hash := encode(digest(raw_token, 'sha256'), 'hex');

  select t.user_id into token_user_id
  from public.mcp_api_tokens t
  where t.token_hash = computed_token_hash
    and t.revoked_at is null
    and t.expires_at > now()
    and coalesce(t.can_read, true) = true
    and t.can_analyze = true
  limit 1;

  if token_user_id is null then
    raise exception 'Invalid, expired, or insufficient MCP token';
  end if;

  return token_user_id;
end;
$$;

create or replace function public.mcp_list_reminder_logs(input_token text, max_rows integer default 50)
returns table (
  id uuid,
  habit_id uuid,
  habit_name text,
  entry_date date,
  scheduled_for timestamptz,
  action text,
  source text,
  snooze_minutes integer,
  notification_id text,
  detail jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  token_user_id uuid;
begin
  token_user_id := public.mcp_token_user_id(input_token);

  return query
  select
    logs.id,
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
  join public.user_habits habits on habits.id = logs.habit_id
  where logs.user_id = token_user_id
  order by logs.created_at desc
  limit least(greatest(coalesce(max_rows, 50), 1), 200);
end;
$$;

create or replace function public.mcp_reminder_effectiveness_report(input_token text, days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  token_user_id uuid;
  safe_days integer;
  result jsonb;
begin
  token_user_id := public.mcp_token_user_id(input_token);
  safe_days := least(greatest(coalesce(days, 14), 1), 90);

  with logs as (
    select habits.name as habit_name, reminder_logs.action
    from public.reminder_logs
    join public.user_habits habits on habits.id = reminder_logs.habit_id
    where reminder_logs.user_id = token_user_id
      and reminder_logs.created_at >= now() - make_interval(days => safe_days)
  ), grouped as (
    select
      habit_name,
      count(*) filter (where action = 'scheduled') as scheduled,
      count(*) filter (where action = 'fired') as fired,
      count(*) filter (where action = 'yes') as yes,
      count(*) filter (where action = 'no') as no,
      count(*) filter (where action = 'later') as later,
      count(*) filter (where action = 'missed') as missed
    from logs
    group by habit_name
  )
  select jsonb_build_object(
    'days', safe_days,
    'summary', coalesce(jsonb_object_agg(habit_name, jsonb_build_object(
      'scheduled', scheduled,
      'fired', fired,
      'yes', yes,
      'no', no,
      'later', later,
      'missed', missed,
      'response_rate', case when fired > 0 then round(((yes + no + later)::numeric / fired::numeric) * 100, 1) else 0 end,
      'yes_rate', case when fired > 0 then round((yes::numeric / fired::numeric) * 100, 1) else 0 end
    )), '{}'::jsonb)
  ) into result
  from grouped;

  return coalesce(result, jsonb_build_object('days', safe_days, 'summary', '{}'::jsonb));
end;
$$;

create or replace function public.mcp_reminder_missed_report(input_token text, end_date date default current_date, days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  token_user_id uuid;
  safe_days integer;
  start_date date;
  result jsonb;
begin
  token_user_id := public.mcp_token_user_id(input_token);
  safe_days := least(greatest(coalesce(days, 14), 1), 90);
  start_date := coalesce(end_date, current_date) - (safe_days - 1);

  with date_series as (
    select generate_series(start_date, coalesce(end_date, current_date), interval '1 day')::date as entry_date
  ), expected as (
    select
      habits.id as habit_id,
      habits.name as habit_name,
      habits.category,
      habits.reminder_time,
      date_series.entry_date
    from public.user_habits habits
    cross join date_series
    where habits.user_id = token_user_id
      and habits.is_archived = false
      and habits.reminder_enabled = true
      and extract(dow from date_series.entry_date)::smallint = any(habits.reminder_repeat_days)
  ), done_logs as (
    select entries.entry_date, logs.habit_id
    from public.daily_entries entries
    join public.daily_habit_logs logs on logs.entry_id = entries.id
    where entries.user_id = token_user_id
      and entries.entry_date between start_date and coalesce(end_date, current_date)
      and logs.done = true
  ), missed as (
    select expected.*
    from expected
    left join done_logs on done_logs.entry_date = expected.entry_date and done_logs.habit_id = expected.habit_id
    where done_logs.habit_id is null
  ), by_habit as (
    select habit_name, count(*) as missed_count
    from missed
    group by habit_name
  )
  select jsonb_build_object(
    'start_date', start_date,
    'end_date', coalesce(end_date, current_date),
    'days', safe_days,
    'total_missed', (select count(*) from missed),
    'by_habit', coalesce((select jsonb_object_agg(habit_name, missed_count) from by_habit), '{}'::jsonb),
    'missed', coalesce((select jsonb_agg(to_jsonb(missed) order by entry_date desc, habit_name) from missed), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.mcp_list_reminder_logs(text, integer) to anon, authenticated;
grant execute on function public.mcp_reminder_effectiveness_report(text, integer) to anon, authenticated;
grant execute on function public.mcp_reminder_missed_report(text, date, integer) to anon, authenticated;
revoke all on function public.mcp_token_user_id(text) from anon, authenticated, public;
