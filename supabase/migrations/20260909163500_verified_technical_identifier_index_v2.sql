-- Jetbase Verified Technical Identifier Index v2
-- Extend the exact-source index only for SAP custom fields beginning with ZZ.
-- These are accepted as verified identifiers only when they literally occur in
-- the published exact-object content. No semantic inference or routing is added.

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
    '(ZZ[A-Z0-9_]{3,}|Z[A-Z0-9]*_[A-Z0-9_]+|Z[A-Z0-9_]{2,}-[0-9]{2,4}|CHECK_[A-Z0-9_]+)((=>|/)[A-Z][A-Z0-9_]*)?',
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
  union all select identifier from content_ids
  union all select identifier from message_ids
), filtered as (
  select distinct identifier
  from all_ids
  where identifier is not null
    and identifier <> ''
    and (
      identifier ~ '^ZZ[A-Z0-9_]{3,}$'
      or identifier ~ '^Z[A-Z0-9_]+(-[0-9]{2,4})?(/[A-Z][A-Z0-9_]*)?$'
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
