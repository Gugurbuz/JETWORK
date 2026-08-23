create table if not exists public.ai_quality_scenarios (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  category text not null default 'regression',
  severity text not null default 'P1' check (severity in ('P0','P1','P2','P3')),
  enabled boolean not null default true,
  model text not null default 'auto',
  project_id text null references public.projects(id) on delete set null,
  tags text[] not null default '{}',
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_quality_steps (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.ai_quality_scenarios(id) on delete cascade,
  step_no integer not null check (step_no >= 1),
  message text not null,
  created_at timestamptz not null default now(),
  unique (scenario_id, step_no)
);

create table if not exists public.ai_quality_assertions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.ai_quality_scenarios(id) on delete cascade,
  position integer not null default 1,
  target_step integer null check (target_step is null or target_step >= 1),
  kind text not null check (kind in ('contains','not_contains','regex','source_canonical','source_name','usage_lte','usage_gte','status','model_is','provider_is')),
  field text null,
  expected_text text null,
  expected_number numeric null,
  required boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_quality_suites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  enabled boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_quality_suite_cases (
  suite_id uuid not null references public.ai_quality_suites(id) on delete cascade,
  scenario_id uuid not null references public.ai_quality_scenarios(id) on delete cascade,
  position integer not null default 1,
  enabled boolean not null default true,
  primary key (suite_id, scenario_id)
);

create table if not exists public.ai_quality_runs (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid null references public.ai_quality_suites(id) on delete set null,
  requested_by uuid null references auth.users(id) on delete set null,
  trigger text not null default 'ui' check (trigger in ('ui','ci','schedule','manual','assistant')),
  endpoint text not null default 'openai-assistant',
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  total_cases integer not null default 0,
  passed_cases integer not null default 0,
  failed_cases integer not null default 0,
  total_cost_usd numeric not null default 0,
  avg_duration_ms numeric not null default 0,
  metadata jsonb not null default '{}',
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_quality_run_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_quality_runs(id) on delete cascade,
  scenario_id uuid not null references public.ai_quality_scenarios(id) on delete cascade,
  workspace_id text null,
  status text not null default 'running' check (status in ('running','passed','failed','error')),
  duration_ms integer not null default 0,
  cost_usd numeric not null default 0,
  provider_calls integer not null default 0,
  tool_calls integer not null default 0,
  score numeric not null default 0,
  failure_summary text null,
  details jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.ai_quality_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_case_id uuid not null references public.ai_quality_run_cases(id) on delete cascade,
  step_no integer not null,
  user_text text not null,
  response_text text not null default '',
  status text not null default 'completed',
  sources jsonb not null default '[]',
  usage jsonb not null default '{}',
  duration_ms integer not null default 0,
  assertion_results jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique(run_case_id, step_no)
);

create index if not exists ai_quality_scenarios_category_idx on public.ai_quality_scenarios(category, enabled);
create index if not exists ai_quality_run_cases_run_idx on public.ai_quality_run_cases(run_id, status);
create index if not exists ai_quality_runs_created_idx on public.ai_quality_runs(created_at desc);

alter table public.ai_quality_scenarios enable row level security;
alter table public.ai_quality_steps enable row level security;
alter table public.ai_quality_assertions enable row level security;
alter table public.ai_quality_suites enable row level security;
alter table public.ai_quality_suite_cases enable row level security;
alter table public.ai_quality_runs enable row level security;
alter table public.ai_quality_run_cases enable row level security;
alter table public.ai_quality_run_steps enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ai_quality_scenarios','ai_quality_steps','ai_quality_assertions','ai_quality_suites','ai_quality_suite_cases','ai_quality_runs','ai_quality_run_cases','ai_quality_run_steps'] loop
    execute format('drop policy if exists quality_authenticated_select on public.%I', t);
    execute format('create policy quality_authenticated_select on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists quality_authenticated_write on public.%I', t);
    execute format('create policy quality_authenticated_write on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into public.ai_quality_suites(slug,name,description) values
 ('smoke','Smoke','Deploy sonrası hızlı kritik kalite kontrolü'),
 ('regression','Regression','Assistant davranış regresyon seti'),
 ('rag-grounding','RAG & Grounding','Kurumsal bilgi, kaynak doğruluğu ve hallucination kontrolleri'),
 ('performance','Performance','Maliyet, provider/tool çağrısı ve süre eşikleri')
on conflict (slug) do update set name=excluded.name, description=excluded.description, updated_at=now();

insert into public.ai_quality_scenarios(slug,name,description,category,severity,model,tags) values
 ('abap-short-message-111','Kısa mesaj numarasından gerçek ABAP','111 kısa referansının ZCRM_COST-111 olarak çözülüp literal kaynak kodunu döndürmesini doğrular.','rag','P0','auto',array['rag','abap','grounding','exact-id']),
 ('check-ztks-followup','CHECK_ZTKS multi-turn follow-up','İlk tur mesaj listesini, ikinci tur referans takibini ve doğru fonksiyon çözümünü doğrular.','follow-up','P0','auto',array['multi-turn','rag','follow-up']),
 ('abap-followup-156','ABAP follow-up 156 hallucination guard','111 kaynak kodu isteğinden sonra 156 kısa follow-up referansının gerçek source ile cevaplanmasını ve sahte budget kodu üretmemesini doğrular.','grounding','P0','auto',array['multi-turn','abap','hallucination'])
on conflict (slug) do update set name=excluded.name, description=excluded.description, category=excluded.category, severity=excluded.severity, model=excluded.model, tags=excluded.tags, updated_at=now();

delete from public.ai_quality_steps where scenario_id in (select id from public.ai_quality_scenarios where slug in ('abap-short-message-111','check-ztks-followup','abap-followup-156'));
delete from public.ai_quality_assertions where scenario_id in (select id from public.ai_quality_scenarios where slug in ('abap-short-message-111','check-ztks-followup','abap-followup-156'));

insert into public.ai_quality_steps(scenario_id,step_no,message) select id,1,'111 nolu hatanın abap kodunu ver' from public.ai_quality_scenarios where slug='abap-short-message-111';
insert into public.ai_quality_steps(scenario_id,step_no,message) select id,1,'CHECK_ZTKS hangi mesajları üretiyor?' from public.ai_quality_scenarios where slug='check-ztks-followup';
insert into public.ai_quality_steps(scenario_id,step_no,message) select id,2,'Peki hangi fonksiyonu çağırıyor?' from public.ai_quality_scenarios where slug='check-ztks-followup';
insert into public.ai_quality_steps(scenario_id,step_no,message) select id,1,'111 nolu hatanın abap kodunu ver' from public.ai_quality_scenarios where slug='abap-followup-156';
insert into public.ai_quality_steps(scenario_id,step_no,message) select id,2,'156 yı ver' from public.ai_quality_scenarios where slug='abap-followup-156';

insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,1,1,'contains','ZCRM_COST-111' from public.ai_quality_scenarios where slug='abap-short-message-111';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,2,1,'contains','MESSAGE e111(zcrm_cost)' from public.ai_quality_scenarios where slug='abap-short-message-111';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,3,1,'source_canonical','message:zcrm_cost-111' from public.ai_quality_scenarios where slug='abap-short-message-111';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,field,expected_number) select id,4,1,'usage_gte','deterministic_authoritative_terminal',1 from public.ai_quality_scenarios where slug='abap-short-message-111';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,field,expected_number) select id,5,1,'usage_lte','primary_llm_agent_calls',1 from public.ai_quality_scenarios where slug='abap-short-message-111';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,field,expected_number) select id,6,1,'usage_lte','estimated_cost_usd',0.03 from public.ai_quality_scenarios where slug='abap-short-message-111';

insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,1,1,'contains','ZCRM2-544' from public.ai_quality_scenarios where slug='check-ztks-followup';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,2,1,'contains','ZCRM2-545' from public.ai_quality_scenarios where slug='check-ztks-followup';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,3,1,'contains','ZCRM2-586' from public.ai_quality_scenarios where slug='check-ztks-followup';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,4,2,'contains','Z_FICA_TKS_CHECK' from public.ai_quality_scenarios where slug='check-ztks-followup';

insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,1,2,'contains','MESSAGE e156(zcrm_cost)' from public.ai_quality_scenarios where slug='abap-followup-156';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,2,2,'not_contains','check_budget_limit' from public.ai_quality_scenarios where slug='abap-followup-156';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,3,2,'not_contains','get_remaining_budget' from public.ai_quality_scenarios where slug='abap-followup-156';
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text) select id,4,2,'source_canonical','method:unscoped_class/ninja_calculate_oncrm' from public.ai_quality_scenarios where slug='abap-followup-156';

insert into public.ai_quality_suite_cases(suite_id,scenario_id,position)
select s.id,c.id,row_number() over(order by c.slug)::int from public.ai_quality_suites s cross join public.ai_quality_scenarios c
where s.slug='regression' and c.slug in ('abap-short-message-111','check-ztks-followup','abap-followup-156')
on conflict(suite_id,scenario_id) do update set enabled=true, position=excluded.position;

insert into public.ai_quality_suite_cases(suite_id,scenario_id,position)
select s.id,c.id,row_number() over(order by c.slug)::int from public.ai_quality_suites s cross join public.ai_quality_scenarios c
where s.slug='smoke' and c.slug in ('abap-short-message-111','check-ztks-followup')
on conflict(suite_id,scenario_id) do update set enabled=true, position=excluded.position;

insert into public.ai_quality_suite_cases(suite_id,scenario_id,position)
select s.id,c.id,row_number() over(order by c.slug)::int from public.ai_quality_suites s cross join public.ai_quality_scenarios c
where s.slug='rag-grounding' and c.slug in ('abap-short-message-111','check-ztks-followup','abap-followup-156')
on conflict(suite_id,scenario_id) do update set enabled=true, position=excluded.position;
