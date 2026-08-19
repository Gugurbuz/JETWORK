-- Preserve Auto model cascade telemetry when the router and live stream proxy
-- update the same assistant turn near-simultaneously.
--
-- Both writers historically use read/merge/write semantics. A stale writer can
-- therefore overwrite fields written milliseconds earlier by the other writer.
-- This trigger is deliberately scoped to Auto-cascade turns only.

create or replace function public.preserve_auto_cascade_usage_on_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old jsonb := coalesce(old.usage, '{}'::jsonb);
  v_new jsonb := coalesce(new.usage, '{}'::jsonb);
  v_merged jsonb;
  v_key text;
  v_old_number numeric;
  v_new_number numeric;
begin
  if jsonb_typeof(v_old) <> 'object' or jsonb_typeof(v_new) <> 'object' then
    return new;
  end if;

  -- Scope the protection to turns where either writer has already attached
  -- Auto-cascade attribution. This avoids changing semantics for legacy turns.
  if not (v_old ? 'auto_model_cascade_started' or v_new ? 'auto_model_cascade_started') then
    return new;
  end if;

  -- Preserve keys that exist only in the current row while allowing the
  -- incoming writer to update its own fields (for example stream timing).
  v_merged := v_old || v_new;

  -- Router usage is additive to the base provider usage. If a stale live-proxy
  -- update arrives later, its copies of these cumulative counters are lower.
  -- Keep the monotonic maximum for the overlapping cumulative fields.
  foreach v_key in array array[
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'total_tokens',
    'estimated_cost_usd',
    'primary_llm_agent_calls',
    'primary_llm_router_calls'
  ]
  loop
    if jsonb_typeof(v_old -> v_key) = 'number' and jsonb_typeof(v_new -> v_key) = 'number' then
      v_old_number := (v_old ->> v_key)::numeric;
      v_new_number := (v_new ->> v_key)::numeric;
      v_merged := jsonb_set(v_merged, array[v_key], to_jsonb(greatest(v_old_number, v_new_number)), true);
    end if;
  end loop;

  new.usage := v_merged;
  return new;
end;
$$;

drop trigger if exists preserve_auto_cascade_usage_on_update on public.assistant_turns;
create trigger preserve_auto_cascade_usage_on_update
before update of usage on public.assistant_turns
for each row
execute function public.preserve_auto_cascade_usage_on_update();

create or replace function public.preserve_auto_cascade_reasoning_summary_on_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old jsonb := coalesce(old.evidence_summary, '{}'::jsonb);
  v_new jsonb := coalesce(new.evidence_summary, '{}'::jsonb);
begin
  if jsonb_typeof(v_old) <> 'object' or jsonb_typeof(v_new) <> 'object' then
    return new;
  end if;

  if not (v_old ? 'autoModelCascade' or v_new ? 'autoModelCascade') then
    return new;
  end if;

  -- autoModelCascade and streamTiming are written by different layers. A
  -- shallow merge is sufficient because they occupy distinct top-level keys.
  new.evidence_summary := v_old || v_new;
  return new;
end;
$$;

drop trigger if exists preserve_auto_cascade_reasoning_summary_on_update on public.assistant_reasoning_runs;
create trigger preserve_auto_cascade_reasoning_summary_on_update
before update of evidence_summary on public.assistant_reasoning_runs
for each row
execute function public.preserve_auto_cascade_reasoning_summary_on_update();
