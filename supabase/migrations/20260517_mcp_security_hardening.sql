alter table public.mcp_api_tokens
  add column if not exists can_read boolean not null default true;

create table if not exists public.mcp_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  token_id uuid references public.mcp_api_tokens (id) on delete set null,
  token_prefix text check (token_prefix is null or char_length(token_prefix) between 1 and 16),
  request_ip text check (request_ip is null or char_length(request_ip) <= 80),
  action text check (action is null or char_length(action) <= 120),
  client_name text check (client_name is null or char_length(client_name) <= 120),
  event_type text not null check (event_type in ('request','success','failure','blocked','failed_auth','suspicious')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists mcp_security_events_user_created_idx
on public.mcp_security_events (user_id, created_at desc);

create index if not exists mcp_security_events_ip_created_idx
on public.mcp_security_events (request_ip, created_at desc);

create index if not exists mcp_security_events_token_created_idx
on public.mcp_security_events (token_id, created_at desc);

create index if not exists mcp_security_events_prefix_created_idx
on public.mcp_security_events (token_prefix, created_at desc);

alter table public.mcp_security_events enable row level security;

drop policy if exists "mcp_security_events_select_own" on public.mcp_security_events;
create policy "mcp_security_events_select_own"
on public.mcp_security_events
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

grant select on public.mcp_security_events to authenticated;

drop view if exists public.mcp_audit_log_view;
create view public.mcp_audit_log_view
with (security_invoker = true)
as
select
  logs.id,
  logs.user_id,
  logs.token_id,
  tokens.label as token_label,
  tokens.token_prefix,
  logs.action,
  logs.client_name,
  logs.success,
  logs.detail,
  logs.error_message,
  logs.created_at
from public.mcp_audit_logs logs
left join public.mcp_api_tokens tokens on tokens.id = logs.token_id;

grant select on public.mcp_audit_log_view to authenticated;

create index if not exists mcp_audit_logs_token_id_created_at_idx
on public.mcp_audit_logs (token_id, created_at desc);

create index if not exists mcp_api_tokens_user_id_active_idx
on public.mcp_api_tokens (user_id, revoked_at, expires_at desc, created_at desc);
