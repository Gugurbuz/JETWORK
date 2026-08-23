-- Migrate the existing assistant_quality_cases catalog into the DB-backed AI Quality Lab.
-- Idempotent: legacy scenarios use stable `legacy-*` slugs and are refreshed on re-run.

with legacy as (
  select c.*,
         'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c
  where c.enabled
)
insert into public.ai_quality_scenarios(slug,name,description,category,severity,enabled,model,tags)
select l.new_slug,
       l.name,
       'Migrated from assistant_quality_cases ' || l.id || E'\nLegacy expectations: ' || l.expectations::text,
       l.category,
       l.severity,
       true,
       'auto',
       array(select distinct x from unnest(coalesce(l.tags,'{}'::text[]) || array['legacy-case',l.id]) x)
from legacy l
on conflict (slug) do update set
  name=excluded.name,
  description=excluded.description,
  category=excluded.category,
  severity=excluded.severity,
  tags=excluded.tags,
  enabled=true,
  updated_at=now();

delete from public.ai_quality_steps s
using public.ai_quality_scenarios q
where s.scenario_id=q.id and q.slug like 'legacy-%';

delete from public.ai_quality_assertions a
using public.ai_quality_scenarios q
where a.scenario_id=q.id and q.slug like 'legacy-%';

with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled
)
insert into public.ai_quality_steps(scenario_id,step_no,message)
select q.id, t.ord::int, t.message
from legacy l
join public.ai_quality_scenarios q on q.slug=l.new_slug
cross join lateral jsonb_array_elements_text(l.turns) with ordinality as t(message,ord);

-- Global required phrases.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled
), rows as (
  select q.id scenario_id, v.value expected_text,
         row_number() over(partition by q.id order by v.ord) pos
  from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug
  cross join lateral jsonb_array_elements_text(coalesce(l.expectations->'must_include','[]'::jsonb)) with ordinality v(value,ord)
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text)
select scenario_id,pos::int,null,'contains',expected_text from rows;

-- Global forbidden phrases.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled
), rows as (
  select q.id scenario_id, v.value expected_text,
         1000 + row_number() over(partition by q.id order by v.ord) pos
  from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug
  cross join lateral jsonb_array_elements_text(coalesce(l.expectations->'must_not_include','[]'::jsonb)) with ordinality v(value,ord)
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text)
select scenario_id,pos::int,null,'not_contains',expected_text from rows;

-- Any-of requirements become one regex assertion.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c
  where c.enabled and jsonb_array_length(coalesce(c.expectations->'must_include_one_of','[]'::jsonb)) > 0
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text)
select q.id,1100,null,'regex','(' || string_agg(v.value,'|') || ')'
from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug
cross join lateral jsonb_array_elements_text(l.expectations->'must_include_one_of') v(value)
group by q.id;

-- Expected canonical source keys.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled
), rows as (
  select q.id scenario_id, v.value expected_text,
         1200 + row_number() over(partition by q.id order by v.ord) pos
  from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug
  cross join lateral jsonb_array_elements_text(coalesce(l.expectations->'expected_source_keys','[]'::jsonb)) with ordinality v(value,ord)
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text)
select scenario_id,pos::int,null,'source_canonical',expected_text from rows;

-- Cost ceilings map directly to assistant usage telemetry.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled and c.expectations ? 'max_cost_usd'
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,field,expected_number)
select q.id,1300,null,'usage_lte','estimated_cost_usd',(l.expectations->>'max_cost_usd')::numeric
from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug;

-- Turn-specific required phrases.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled and jsonb_typeof(c.expectations->'turn_expectations')='array'
), te as (
  select q.id scenario_id, e.obj, e.ord::int target_step
  from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug
  cross join lateral jsonb_array_elements(l.expectations->'turn_expectations') with ordinality e(obj,ord)
), inc as (
  select scenario_id,target_step,v.value expected_text,
         2000 + target_step*100 + row_number() over(partition by scenario_id,target_step order by v.ord) pos
  from te cross join lateral jsonb_array_elements_text(coalesce(te.obj->'must_include','[]'::jsonb)) with ordinality v(value,ord)
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text)
select scenario_id,pos::int,target_step,'contains',expected_text from inc;

-- Turn-specific forbidden phrases.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled and jsonb_typeof(c.expectations->'turn_expectations')='array'
), te as (
  select q.id scenario_id, e.obj, e.ord::int target_step
  from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug
  cross join lateral jsonb_array_elements(l.expectations->'turn_expectations') with ordinality e(obj,ord)
), exc as (
  select scenario_id,target_step,v.value expected_text,
         4000 + target_step*100 + row_number() over(partition by scenario_id,target_step order by v.ord) pos
  from te cross join lateral jsonb_array_elements_text(coalesce(te.obj->'must_not_include','[]'::jsonb)) with ordinality v(value,ord)
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text)
select scenario_id,pos::int,target_step,'not_contains',expected_text from exc;

-- Turn-specific any-of.
with legacy as (
  select c.*, 'legacy-' || trim(both '-' from regexp_replace(lower(c.id), '[^a-z0-9]+', '-', 'g')) as new_slug
  from public.assistant_quality_cases c where c.enabled and jsonb_typeof(c.expectations->'turn_expectations')='array'
), te as (
  select q.id scenario_id, e.obj, e.ord::int target_step
  from legacy l join public.ai_quality_scenarios q on q.slug=l.new_slug
  cross join lateral jsonb_array_elements(l.expectations->'turn_expectations') with ordinality e(obj,ord)
  where jsonb_array_length(coalesce(e.obj->'must_include_one_of','[]'::jsonb)) > 0
)
insert into public.ai_quality_assertions(scenario_id,position,target_step,kind,expected_text)
select scenario_id,6000+target_step,target_step,'regex','(' || string_agg(v.value,'|') || ')'
from te cross join lateral jsonb_array_elements_text(te.obj->'must_include_one_of') v(value)
group by scenario_id,target_step;

-- Refresh suite membership for migrated cases.
delete from public.ai_quality_suite_cases sc
using public.ai_quality_scenarios q
where sc.scenario_id=q.id and q.slug like 'legacy-%';

insert into public.ai_quality_suite_cases(suite_id,scenario_id,position,enabled)
select s.id,q.id,row_number() over(order by q.severity,q.slug),true
from public.ai_quality_suites s cross join public.ai_quality_scenarios q
where s.slug='regression' and q.slug like 'legacy-%'
on conflict (suite_id,scenario_id) do update set enabled=true;

insert into public.ai_quality_suite_cases(suite_id,scenario_id,position,enabled)
select s.id,q.id,row_number() over(order by q.slug),true
from public.ai_quality_suites s cross join public.ai_quality_scenarios q
where s.slug='smoke' and q.slug like 'legacy-%' and q.severity='P0'
on conflict (suite_id,scenario_id) do update set enabled=true;

insert into public.ai_quality_suite_cases(suite_id,scenario_id,position,enabled)
select s.id,q.id,row_number() over(order by q.severity,q.slug),true
from public.ai_quality_suites s cross join public.ai_quality_scenarios q
where s.slug='rag-grounding' and q.slug like 'legacy-%'
  and q.category not in ('casual','general_world')
on conflict (suite_id,scenario_id) do update set enabled=true;

insert into public.ai_quality_suite_cases(suite_id,scenario_id,position,enabled)
select s.id,q.id,row_number() over(order by q.slug),true
from public.ai_quality_suites s cross join public.ai_quality_scenarios q
join public.assistant_quality_cases c on q.tags @> array[c.id]::text[]
where s.slug='performance' and q.slug like 'legacy-%'
  and (c.expectations ? 'max_cost_usd' or c.expectations ? 'max_duration_ms' or c.expectations ? 'max_tool_calls' or c.expectations ? 'max_knowledge_tool_calls')
on conflict (suite_id,scenario_id) do update set enabled=true;
