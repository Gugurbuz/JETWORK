create table if not exists public.assistant_reasoning_runs (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null unique references public.assistant_turns(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(uid),
  prompt_version_id uuid references public.assistant_prompt_versions(id),
  engine_version text not null default 'reasoning-engine-v2',
  intent text not null,
  complexity text not null,
  plan jsonb not null default '{}'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  execution_trace jsonb not null default '[]'::jsonb,
  evidence_summary jsonb not null default '{}'::jsonb,
  knowledge_used boolean not null default false,
  web_used boolean not null default false,
  tool_call_count integer not null default 0,
  fallback_used boolean not null default false,
  status text not null default 'running',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint assistant_reasoning_runs_intent_check check (intent in ('simple_answer','sap_diagnosis','research','analysis','document','decision','project')),
  constraint assistant_reasoning_runs_complexity_check check (complexity in ('low','medium','high')),
  constraint assistant_reasoning_runs_status_check check (status in ('running','completed','failed')),
  constraint assistant_reasoning_runs_tool_count_check check (tool_call_count >= 0)
);

create index if not exists assistant_reasoning_runs_workspace_started_idx
  on public.assistant_reasoning_runs(workspace_id, started_at desc);
create index if not exists assistant_reasoning_runs_owner_started_idx
  on public.assistant_reasoning_runs(owner_id, started_at desc);
create index if not exists assistant_reasoning_runs_intent_complexity_idx
  on public.assistant_reasoning_runs(intent, complexity, started_at desc);

alter table public.assistant_reasoning_runs enable row level security;

revoke all on table public.assistant_reasoning_runs from anon, authenticated;

comment on table public.assistant_reasoning_runs is
  'Operational execution ledger for JetWork Reasoning Engine v2. Stores task plans, evidence/verification summaries and observable execution trace; never private chain-of-thought.';
comment on column public.assistant_reasoning_runs.execution_trace is
  'Observable system actions only (routing, searches, tool calls, verification and synthesis), not hidden model reasoning.';
