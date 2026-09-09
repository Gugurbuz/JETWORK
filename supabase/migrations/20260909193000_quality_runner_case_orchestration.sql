alter table public.ai_quality_assertions
  drop constraint if exists ai_quality_assertions_kind_check;

alter table public.ai_quality_assertions
  add constraint ai_quality_assertions_kind_check check (
    kind in (
      'contains','not_contains','response_nonempty','regex','source_canonical','source_name',
      'usage_lte','usage_gte','status','model_is','provider_is'
    )
  );

create unique index if not exists ai_quality_run_cases_run_scenario_uidx
  on public.ai_quality_run_cases(run_id, scenario_id);

insert into public.ai_quality_scenarios (
  slug, name, description, category, severity, enabled, model, tags
) values (
  'live-basic-assistant',
  'Canlı temel asistan yanıtı',
  'Production asistanın kısa bir genel sohbet mesajına boş olmayan ve hata metni içermeyen cevap vermesini doğrular.',
  'general-chat',
  'P0',
  true,
  'auto',
  array['live','smoke','production']
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  severity = excluded.severity,
  enabled = excluded.enabled,
  model = excluded.model,
  tags = excluded.tags,
  updated_at = now();

delete from public.ai_quality_steps
where scenario_id = (select id from public.ai_quality_scenarios where slug = 'live-basic-assistant');

delete from public.ai_quality_assertions
where scenario_id = (select id from public.ai_quality_scenarios where slug = 'live-basic-assistant');

insert into public.ai_quality_steps(scenario_id, step_no, message)
select id, 1, 'Merhaba. Lütfen yalnızca iki kısa cümleyle yanıt ver.'
from public.ai_quality_scenarios where slug = 'live-basic-assistant';

insert into public.ai_quality_assertions(scenario_id, position, target_step, kind, expected_text)
select id, 1, 1, 'status', 'completed'
from public.ai_quality_scenarios where slug = 'live-basic-assistant'
union all
select id, 2, 1, 'response_nonempty', null
from public.ai_quality_scenarios where slug = 'live-basic-assistant'
union all
select id, 3, 1, 'not_contains', 'OpenAI API kullanım kredisi'
from public.ai_quality_scenarios where slug = 'live-basic-assistant'
union all
select id, 4, 1, 'not_contains', 'Yanıt tamamlanamadı'
from public.ai_quality_scenarios where slug = 'live-basic-assistant';

delete from public.ai_quality_assertions
where scenario_id = (select id from public.ai_quality_scenarios where slug = 'abap-short-message-111')
  and kind = 'usage_gte'
  and field = 'deterministic_authoritative_terminal';

update public.ai_quality_suites
set description = 'Production deploy sonrası kritik genel yanıt, grounding, follow-up ve fail-closed kontrolleri.',
    updated_at = now()
where slug = 'smoke';

update public.ai_quality_suites
set description = 'Gece çalıştırılan kapsamlı current ve legacy davranış regresyon paketi.',
    updated_at = now()
where slug = 'regression';

delete from public.ai_quality_suite_cases
where suite_id = (select id from public.ai_quality_suites where slug = 'smoke');

insert into public.ai_quality_suite_cases(suite_id, scenario_id, position, enabled)
select suite.id, scenario.id, selected.position, true
from (values
  ('live-basic-assistant', 1),
  ('abap-short-message-111', 2),
  ('check-ztks-followup', 3),
  ('legacy-c07', 4)
) as selected(slug, position)
join public.ai_quality_scenarios scenario on scenario.slug = selected.slug
cross join lateral (select id from public.ai_quality_suites where slug = 'smoke') suite;

update public.ai_quality_run_cases
set status = 'error',
    failure_summary = coalesce(failure_summary, 'Runner 15 dakika içinde tamamlanamadı.'),
    completed_at = coalesce(completed_at, now())
where status = 'running'
  and started_at < now() - interval '15 minutes';

update public.ai_quality_runs
set status = 'failed',
    failed_cases = greatest(failed_cases, 1),
    completed_at = coalesce(completed_at, now()),
    metadata = metadata || jsonb_build_object('failureReason', 'stale_runner_timeout')
where status = 'running'
  and started_at < now() - interval '15 minutes';
