-- Fail closed for identifier-heavy enterprise knowledge queries.
-- Semantic/vector retrieval remains enabled for general natural-language search,
-- but short acronyms and technical identifiers must actually occur in the
-- candidate evidence before that candidate can become a corporate citation.

create or replace function public.hybrid_search_knowledge_catalog_v2(
  p_workspace_id text,
  p_query text,
  p_query_embedding public.vector default null,
  p_object_types text[] default null,
  p_limit integer default 8
)
returns table(
  object_id uuid,
  canonical_key text,
  object_type text,
  object_name text,
  title text,
  summary text,
  content text,
  chunk_id uuid,
  chunk_index integer,
  chunk_content text,
  citation jsonb,
  source_id uuid,
  source_name text,
  scope_type text,
  score double precision,
  lexical_score double precision,
  vector_score double precision
)
language sql
security definer
set search_path = ''
as $$
  with raw_query as (
    select trim(coalesce(p_query, '')) as query_text
  ), query_input as (
    select
      rq.query_text,
      case
        when rq.query_text <> ''
          then websearch_to_tsquery('simple'::regconfig, rq.query_text)
        else null::tsquery
      end as query_ts,
      coalesce((
        select array_agg(distinct token.normalized_token order by token.normalized_token)
        from (
          select
            raw_token,
            replace(translate(lower(raw_token), 'ı', 'i'), U&'\0307', '') as normalized_token
          from regexp_split_to_table(rq.query_text, '[^[:alnum:]_/-]+') as raw_token
        ) token
        where token.normalized_token <> ''
          and token.normalized_token not in (
            've','bu','ne','mi','mu','ile','bir','iki','da','de','ya','ki'
          )
          and (
            char_length(token.normalized_token) between 2 and 3
            or token.raw_token ~ '[0-9_/-]'
            or (
              char_length(token.raw_token) between 2 and 10
              and token.raw_token ~ '[[:upper:]]'
              and token.raw_token = upper(token.raw_token)
            )
          )
      ), '{}'::text[]) as anchor_tokens
    from raw_query rq
  ), ctx as (
    select * from public.resolve_knowledge_context(p_workspace_id)
  ), spaces as (
    select global_space_id as id, 'global'::text as scope_type, 0.0::double precision as scope_bonus, 1 as priority from ctx
    union all
    select project_space_id, 'project'::text, 0.08::double precision, 0 from ctx where project_space_id is not null
  ), candidates as (
    select
      o.id as object_id,
      o.canonical_key,
      o.published_object_type as object_type,
      o.published_name as object_name,
      v.title,
      v.summary,
      v.content as object_content,
      c.id as chunk_id,
      c.chunk_index,
      c.content as chunk_content,
      c.metadata as chunk_metadata,
      s.id as source_id,
      s.name as source_name,
      sp.scope_type,
      sp.scope_bonus,
      sp.priority,
      q.anchor_tokens,
      (
        cardinality(q.anchor_tokens) = 0
        or q.anchor_tokens <@ regexp_split_to_array(
          trim(regexp_replace(
            replace(translate(lower(concat_ws(
              ' ',
              o.canonical_key,
              o.published_name,
              v.title,
              v.summary,
              v.content,
              c.content,
              s.name
            )), 'ı', 'i'), U&'\0307', ''),
            '[^[:alnum:]_/-]+',
            ' ',
            'g'
          )),
          ' +'
        )
      ) as anchor_match,
      greatest(
        case when upper(o.canonical_key)=upper(q.query_text) then 1.0 else 0.0 end,
        case when o.published_normalized_name=upper(q.query_text) then 0.98 else 0.0 end,
        case when upper(o.canonical_key) like upper(q.query_text)||'%' then 0.9 else 0.0 end,
        case when o.published_normalized_name like upper(q.query_text)||'%' then 0.88 else 0.0 end,
        extensions.similarity(o.canonical_key,q.query_text)*0.78,
        extensions.similarity(o.published_normalized_name,upper(q.query_text))*0.76,
        case when q.query_ts is not null and v.search_document @@ q.query_ts then 0.72 else 0.0 end,
        case when q.query_ts is not null and c.search_document @@ q.query_ts then 0.82 else 0.0 end,
        coalesce(extensions.similarity(left(c.content, 800), q.query_text)*0.58, 0.0)
      )::double precision as lexical_score,
      case
        when p_query_embedding is not null and c.embedding is not null
          then greatest(0.0, 1 - (c.embedding operator(public.<=>) p_query_embedding))::double precision
        else 0.0::double precision
      end as vector_score
    from query_input q
    cross join spaces sp
    join public.knowledge_objects_v2 o on o.knowledge_space_id=sp.id
    join public.knowledge_object_versions_v2 v on v.id=o.published_version_id
    join public.knowledge_source_versions_v2 sv on sv.id=o.published_source_version_id
    join public.knowledge_sources_v2 s on s.id=sv.source_id
    left join public.knowledge_chunks_v2 c on c.object_version_id=v.id
    where o.publication_status='published'
      and s.publication_status='published'
      and s.published_version_id=sv.id
      and q.query_text <> ''
      and (p_object_types is null or o.published_object_type=any(p_object_types))
  ), ranked as (
    select
      candidates.*,
      least(1.0, greatest(lexical_score, vector_score * 0.92) + scope_bonus)::double precision as final_score,
      row_number() over (
        partition by scope_type, canonical_key, coalesce(chunk_id::text, 'object')
        order by greatest(lexical_score, vector_score * 0.92) desc, chunk_index nulls last
      ) as duplicate_rank
    from candidates
  )
  select
    ranked.object_id,
    ranked.canonical_key,
    ranked.object_type,
    ranked.object_name,
    ranked.title,
    ranked.summary,
    coalesce(ranked.chunk_content, ranked.object_content) as content,
    ranked.chunk_id,
    ranked.chunk_index,
    ranked.chunk_content,
    jsonb_build_object(
      'chunkId', ranked.chunk_id,
      'chunkIndex', ranked.chunk_index,
      'sectionTitle', ranked.chunk_metadata->>'sectionTitle',
      'headingPath', ranked.chunk_metadata->'headingPath',
      'startLine', ranked.chunk_metadata->>'startLine',
      'sourceId', ranked.source_id,
      'sourceName', ranked.source_name
    ) as citation,
    ranked.source_id,
    ranked.source_name,
    ranked.scope_type,
    ranked.final_score as score,
    ranked.lexical_score,
    ranked.vector_score
  from ranked
  where ranked.duplicate_rank = 1
    and ranked.anchor_match
    and (
      ranked.lexical_score >= 0.18
      or ranked.vector_score >= 0.50
    )
  order by ranked.final_score desc, ranked.priority, ranked.canonical_key, ranked.chunk_index nulls last
  limit greatest(1,least(p_limit,20));
$$;

revoke execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from public;
revoke execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from anon;
grant execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) to authenticated;
grant execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) to service_role;

comment on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) is
  'Hybrid published knowledge retrieval with lexical/vector ranking plus fail-closed exact-anchor evidence gating for acronyms and technical identifiers.';
