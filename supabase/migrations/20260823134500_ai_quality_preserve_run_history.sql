alter table public.ai_quality_run_cases drop constraint if exists ai_quality_run_cases_scenario_id_fkey;
alter table public.ai_quality_run_cases add constraint ai_quality_run_cases_scenario_id_fkey foreign key (scenario_id) references public.ai_quality_scenarios(id) on delete restrict;
