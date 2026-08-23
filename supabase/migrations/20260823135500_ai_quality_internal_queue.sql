create table if not exists public.ai_quality_internal_config (
  key text primary key,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_quality_internal_config enable row level security;

insert into public.ai_quality_internal_config(key, secret)
values ('runner_webhook_secret', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table if not exists public.ai_quality_run_requests (
  id uuid primary key default gen_random_uuid(),
  suite_slug text not null,
  endpoint text not null default 'openai-assistant-v2',
  trigger text not null default 'assistant',
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  response jsonb not null default '{}',
  error_message text null,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null
);
alter table public.ai_quality_run_requests enable row level security;

create or replace function public.dispatch_ai_quality_run_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
  request_id bigint;
begin
  select secret into webhook_secret
  from public.ai_quality_internal_config
  where key = 'runner_webhook_secret';

  if webhook_secret is null then
    raise exception 'AI quality runner webhook secret is not configured';
  end if;

  select net.http_post(
    url := 'https://bpbbvjigostgrssnduhk.supabase.co/functions/v1/ai-quality-runner-internal',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('requestId', new.id, 'secret', webhook_secret)
  ) into request_id;

  update public.ai_quality_run_requests
  set response = jsonb_build_object('dispatchRequestId', request_id)
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists ai_quality_run_request_dispatch on public.ai_quality_run_requests;
create trigger ai_quality_run_request_dispatch
after insert on public.ai_quality_run_requests
for each row execute function public.dispatch_ai_quality_run_request();
