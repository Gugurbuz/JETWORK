-- Verified technical identifier index for exact Jetbase knowledge objects.
--
-- Purpose:
-- - Preserve mechanically verified technical identifiers before Edge/runtime
--   truncation so final grounding can validate identifiers that occur late in
--   large ABAP sources.
-- - Derive canonical parent/leaf aliases from the exact published canonical key.
-- - Preserve fail-closed grounding: this function only indexes identifiers that
--   already exist in the exact canonical key or published source content.
-- - No semantic routing, planning or recovery behavior is introduced here.

create or replace function public.with_verified_technical_identifier_index_v1(
  p_canonical_key text,
  p_content text,
  p_limit integer default 256
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
with canonical_parts as (
  select upper(regexp_replace(coalesce(p_canonical_key, ''), '^[^:]+:', '')) as canonical_identifier
), canonical_ids as (
  select canonical_identifier as identifier
  from canonical_parts
  where canonical_identifier <> ''

  union all

  select split_part(canonical_identifier, '/', 1)
  from canonical_parts
  where canonical_identifier like '%/%'

  union all

  select split_part(canonical_identifier, '/', 2)
  from canonical_parts
  where canonical_identifier like '%/%'
), content_ids as (
  select upper(m[1] || replace(coalesce(m[2], ''), '=>', '/')) as identifier
  from regexp_matches(
    coalesce(p_content, ''),
    '(Z[A-Z0-9]*_[A-Z0-9_]+|Z[A-Z0-9_]{2,}-[0-9]{2,4}|CHECK_[A-Z0-9_]+)((=>|/)[A-Z][A-Z0-9_]*)?',
    'gi'
  ) m
), message_ids as (
  select upper(m[2]) || '-' || lpad(m[1], 3, '0') as identifier
  from regexp_matches(
    coalesce(p_content, ''),
    'MESSAGE[[:space:]]+[A-Z]?([0-9]{2,4})\(([A-Z][A-Z0-9_]*)\)',
    'gi'
  ) m
), all_ids as (
  select identifier from canonical_ids
  union all
  select identifier from content_ids
  union all
  select identifier from message_ids
), filtered as (
  select distinct identifier
  from all_ids
  where identifier is not null
    and identifier <> ''
    and (
      identifier ~ '^Z[A-Z0-9_]+(-[0-9]{2,4})?(/[A-Z][A-Z0-9_]*)?$'
      or identifier ~ '^CHECK_[A-Z0-9_]+$'
    )
  order by identifier
  limit greatest(1, least(coalesce(p_limit, 256), 512))
), packed as (
  select array_agg(identifier order by identifier) as identifiers
  from filtered
)
select case
  when coalesce(array_length(identifiers, 1), 0) = 0 then coalesce(p_content, '')
  else '[VERIFIED_TECHNICAL_IDENTIFIERS]' || E'\n'
    || array_to_string(identifiers, ', ')
    || E'\n[END_VERIFIED_TECHNICAL_IDENTIFIERS]\n'
    || coalesce(p_content, '')
end
from packed;
$function$;

revoke all on function public.with_verified_technical_identifier_index_v1(text,text,integer) from public;
revoke all on function public.with_verified_technical_identifier_index_v1(text,text,integer) from anon;
revoke all on function public.with_verified_technical_identifier_index_v1(text,text,integer) from authenticated;

create or replace function public.get_knowledge_object_v2(
  p_workspace_id text,
  p_canonical_key text,
  p_object_types text[] default null::text[]
)
returns table(
  canonical_key text,
  object_type text,
  object_name text,
  title text,
  summary text,
  content text,
  version_number integer,
  source_id uuid,
  source_name text,
  scope_type text
)
language sql
security definer
set search_path to ''
as $function$
with ctx as (
  select * from public.resolve_knowledge_context(p_workspace_id)
), spaces as (
  select project_space_id id,'project'::text scope_type,0 priority from ctx where project_space_id is not null
  union all
  select global_space_id,'global'::text,1 from ctx
), requested as (
  select sp.*, o as requested_object,
         public.resolve_knowledge_canonical_alias_v1(sp.id, lower(trim(p_canonical_key))) as resolved_key
  from spaces sp
  join public.knowledge_objects_v2 o
    on o.knowledge_space_id = sp.id
   and o.canonical_key = lower(trim(p_canonical_key))
   and o.publication_status = 'published'
), resolved as (
  select r.*,
         ro.published_object_type as resolved_type,
         ro.published_name as resolved_name,
         rv.title as resolved_title,
         rv.summary as resolved_summary,
         rv.content as resolved_content,
         rv.version_number as resolved_version_number,
         rs.id as resolved_source_id,
         rs.name as resolved_source_name
  from requested r
  join public.knowledge_objects_v2 ro
    on ro.knowledge_space_id = r.id
   and ro.canonical_key = r.resolved_key
   and ro.publication_status = 'published'
  join public.knowledge_object_versions_v2 rv on rv.id = ro.published_version_id
  join public.knowledge_source_versions_v2 rsv on rsv.id = ro.published_source_version_id
  join public.knowledge_sources_v2 rs
    on rs.id = rsv.source_id
   and rs.published_version_id = rsv.id
   and rs.publication_status = 'published'
)
select
  lower(trim(p_canonical_key)) as canonical_key,
  coalesce((r.requested_object).published_object_type, r.resolved_type) as object_type,
  coalesce((r.requested_object).published_name, r.resolved_name) as object_name,
  case when r.resolved_key <> lower(trim(p_canonical_key))
       then coalesce((r.requested_object).published_name, r.resolved_title, r.resolved_name)
       else r.resolved_title end as title,
  r.resolved_summary as summary,
  public.with_verified_technical_identifier_index_v1(
    lower(trim(p_canonical_key)),
    r.resolved_content,
    256
  ) as content,
  r.resolved_version_number as version_number,
  r.resolved_source_id as source_id,
  r.resolved_source_name as source_name,
  r.scope_type
from resolved r
where p_object_types is null
   or coalesce((r.requested_object).published_object_type, r.resolved_type) = any(p_object_types)
order by r.priority
limit 1;
$function$;

revoke all on function public.get_knowledge_object_v2(text,text,text[]) from public;
revoke all on function public.get_knowledge_object_v2(text,text,text[]) from anon;
grant execute on function public.get_knowledge_object_v2(text,text,text[]) to authenticated;
