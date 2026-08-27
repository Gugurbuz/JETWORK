-- Promote relation-derived placeholder objects when a later source provides
-- a real/non-synthetic object version for the same canonical key.
--
-- The promotion is intentionally driven by source-version membership rather
-- than by loose text matching. This means a placeholder is only considered
-- resolved when ingestion has materialized an actual object version and linked
-- that version to the source under the same canonical object identity.

create or replace function public.promote_synthetic_knowledge_object_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object public.knowledge_objects_v2%rowtype;
  v_version public.knowledge_object_versions_v2%rowtype;
  v_is_real_version boolean := false;
begin
  select *
    into v_version
    from public.knowledge_object_versions_v2
   where id = new.object_version_id
     and object_id = new.object_id
     and knowledge_space_id = new.knowledge_space_id;

  if v_version.id is null then
    return new;
  end if;

  -- Structural endpoint versions are themselves placeholders. Only a version
  -- produced from real parsed/compiled source content may promote the object.
  v_is_real_version :=
    not coalesce((v_version.metadata->>'synthetic')::boolean, false)
    and not coalesce((v_version.metadata->>'structuralEndpoint')::boolean, false);

  if not v_is_real_version then
    return new;
  end if;

  select *
    into v_object
    from public.knowledge_objects_v2
   where id = new.object_id
     and knowledge_space_id = new.knowledge_space_id
   for update;

  if v_object.id is null
     or not coalesce((v_object.metadata->>'synthetic')::boolean, false) then
    return new;
  end if;

  update public.knowledge_objects_v2
     set metadata = (coalesce(metadata, '{}'::jsonb) - 'syntheticReason')
                    || jsonb_build_object(
                         'synthetic', false,
                         'promotedFromSynthetic', true,
                         'promotedAt', now(),
                         'promotedSourceVersionId', new.source_version_id,
                         'promotedObjectVersionId', new.object_version_id
                       ),
         updated_at = now()
   where id = new.object_id;

  update public.knowledge_review_items_v3
     set status = 'resolved',
         resolved_at = now(),
         payload = coalesce(payload, '{}'::jsonb)
                   || jsonb_build_object(
                        'autoResolved', true,
                        'resolutionReason', 'real_object_materialized',
                        'resolvedSourceVersionId', new.source_version_id,
                        'resolvedObjectVersionId', new.object_version_id
                      )
   where knowledge_space_id = new.knowledge_space_id
     and canonical_key = v_object.canonical_key
     and review_type = 'synthetic_endpoint'
     and status = 'open';

  return new;
end;
$$;

revoke all on function public.promote_synthetic_knowledge_object_v4() from public;
revoke all on function public.promote_synthetic_knowledge_object_v4() from anon;
revoke all on function public.promote_synthetic_knowledge_object_v4() from authenticated;

drop trigger if exists trg_promote_synthetic_knowledge_object_v4
  on public.knowledge_source_version_objects_v2;

create trigger trg_promote_synthetic_knowledge_object_v4
after insert or update of object_version_id
on public.knowledge_source_version_objects_v2
for each row
execute function public.promote_synthetic_knowledge_object_v4();

-- Conservative backfill: resolve only placeholders that already have at least
-- one linked non-synthetic/non-structural source version. Relation-only
-- placeholders (including today's open review queue) are deliberately left open.
with promotable as (
  select distinct
         o.id as object_id,
         o.knowledge_space_id,
         o.canonical_key,
         m.source_version_id,
         m.object_version_id
    from public.knowledge_objects_v2 o
    join public.knowledge_source_version_objects_v2 m
      on m.object_id = o.id
     and m.knowledge_space_id = o.knowledge_space_id
    join public.knowledge_object_versions_v2 v
      on v.id = m.object_version_id
   where coalesce((o.metadata->>'synthetic')::boolean, false)
     and not coalesce((v.metadata->>'synthetic')::boolean, false)
     and not coalesce((v.metadata->>'structuralEndpoint')::boolean, false)
), chosen as (
  select distinct on (object_id)
         object_id,
         knowledge_space_id,
         canonical_key,
         source_version_id,
         object_version_id
    from promotable
   order by object_id, source_version_id desc, object_version_id desc
)
update public.knowledge_objects_v2 o
   set metadata = (coalesce(o.metadata, '{}'::jsonb) - 'syntheticReason')
                  || jsonb_build_object(
                       'synthetic', false,
                       'promotedFromSynthetic', true,
                       'promotedAt', now(),
                       'promotedSourceVersionId', c.source_version_id,
                       'promotedObjectVersionId', c.object_version_id
                     ),
       updated_at = now()
  from chosen c
 where o.id = c.object_id;

with resolved as (
  select distinct
         o.knowledge_space_id,
         o.canonical_key,
         (o.metadata->>'promotedSourceVersionId')::uuid as source_version_id,
         (o.metadata->>'promotedObjectVersionId')::uuid as object_version_id
    from public.knowledge_objects_v2 o
   where coalesce((o.metadata->>'promotedFromSynthetic')::boolean, false)
     and not coalesce((o.metadata->>'synthetic')::boolean, false)
)
update public.knowledge_review_items_v3 q
   set status = 'resolved',
       resolved_at = now(),
       payload = coalesce(q.payload, '{}'::jsonb)
                 || jsonb_build_object(
                      'autoResolved', true,
                      'resolutionReason', 'real_object_materialized_backfill',
                      'resolvedSourceVersionId', r.source_version_id,
                      'resolvedObjectVersionId', r.object_version_id
                    )
  from resolved r
 where q.knowledge_space_id = r.knowledge_space_id
   and q.canonical_key = r.canonical_key
   and q.review_type = 'synthetic_endpoint'
   and q.status = 'open';
