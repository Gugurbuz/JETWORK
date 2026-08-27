-- Prevent ABAP non-SQL syntax from being materialized as database-table graph edges.
-- Examples this blocks:
--   LOOP AT lt_any INTO ls_any FROM sy-tabix.          -> NOT table:SY
--   INSERT lr_message->convert( ) INTO TABLE et_msg.  -> NOT table:LR_MESSAGE
--
-- The guard is intentionally scoped to ABAP method archives and only to
-- READS/WRITES relations whose target is a table endpoint. Other document
-- types and graph relation types are unaffected.

create or replace function public.is_valid_abap_table_relation_v5(
  p_raw_text text,
  p_document_type text,
  p_relation jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_relation_type text := upper(coalesce(p_relation->>'relationType',''));
  v_source_key text := lower(coalesce(p_relation->>'sourceCanonicalKey',''));
  v_target_key text := lower(coalesce(p_relation->>'targetCanonicalKey',''));
  v_method_name text;
  v_table_name text;
  v_body text;
begin
  if coalesce(p_document_type,'') <> 'abap_method_archive' then
    return true;
  end if;

  if v_relation_type not in ('READS','WRITES')
     or v_target_key not like 'table:%'
     or v_source_key not like 'method:%/%' then
    return true;
  end if;

  v_method_name := upper(regexp_replace(v_source_key, '^.*/', ''));
  v_table_name := upper(substr(v_target_key, length('table:') + 1));

  if v_method_name = '' or v_table_name = '' then
    return true;
  end if;

  -- Strong signal that the identifier is an ABAP data object/system structure,
  -- not a DDIC/Open SQL table. This is not the primary validator; statement
  -- context below is. It mainly protects ambiguous MODIFY-like syntax.
  if v_table_name ~ '^(SY|L[STVORX]_|G[STVOR]_|I[STVOR]_|E[STVOR]_|C[STVOR]_|M[STVOR]_)' then
    return false;
  end if;

  select (regexp_match(
           coalesce(p_raw_text,''),
           '(?is)\mMETHOD\M[[:space:]]+' || v_method_name || '[[:space:]]*\.(.*?)\mENDMETHOD\M[[:space:]]*\.'
         ))[1]
    into v_body;

  -- If the method cannot be isolated, fail open rather than discarding a
  -- potentially valid enterprise dependency.
  if v_body is null then
    return true;
  end if;

  v_body := upper(v_body);

  if v_relation_type = 'READS' then
    -- A table read is accepted only when FROM/JOIN occurs inside the same
    -- SELECT statement. [^.] prevents LOOP ... FROM, SUBTRACT ... FROM, etc.
    return
      v_body ~ ('\mSELECT\M[^.]*\mFROM\M[[:space:]]+' || v_table_name || '([[:space:].,]|$)')
      or v_body ~ ('\mSELECT\M[^.]*\mJOIN\M[[:space:]]+' || v_table_name || '([[:space:].,]|$)');
  end if;

  -- WRITES: accept only Open SQL-shaped statements. In particular, generic
  -- INSERT <expr> INTO TABLE <itab> is intentionally not treated as DB write.
  return
    v_body ~ ('\mUPDATE\M[[:space:]]+' || v_table_name || '[[:space:]]+\mSET\M')
    or v_body ~ ('\mDELETE\M[[:space:]]+\mFROM\M[[:space:]]+' || v_table_name || '([[:space:].]|$)')
    or v_body ~ ('\mINSERT\M[[:space:]]+' || v_table_name || '[[:space:]]+\mFROM\M')
    or v_body ~ ('\mINSERT\M[[:space:]]+\mINTO\M[[:space:]]+' || v_table_name || '([[:space:].]|$)')
    or v_body ~ ('\mMODIFY\M[[:space:]]+' || v_table_name || '[[:space:]]+\mFROM\M');
end;
$$;

revoke all on function public.is_valid_abap_table_relation_v5(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_abap_table_relation_v5(text,text,jsonb) to service_role;

-- Preserve the existing, battle-tested ingestion implementation behind an
-- internal name and put the semantic guard at the public ingestion boundary.
alter function public.ingest_knowledge_catalog_v2(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) rename to ingest_knowledge_catalog_v2_unsanitized_v5;

revoke all on function public.ingest_knowledge_catalog_v2_unsanitized_v5(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_knowledge_catalog_v2_unsanitized_v5(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) to service_role;

create or replace function public.ingest_knowledge_catalog_v2(
  p_job_id uuid,
  p_knowledge_space_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_content_hash text,
  p_raw_text text,
  p_parser_version text,
  p_document_type text,
  p_objects jsonb,
  p_relations jsonb,
  p_warnings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relations jsonb := '[]'::jsonb;
  v_objects jsonb := '[]'::jsonb;
  v_result jsonb;
  v_input_relation_count integer := coalesce(jsonb_array_length(coalesce(p_relations,'[]'::jsonb)),0);
  v_input_object_count integer := coalesce(jsonb_array_length(coalesce(p_objects,'[]'::jsonb)),0);
  v_relation_count integer := 0;
  v_object_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_relations,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_objects,'[]'::jsonb)) <> 'array' then
    -- Delegate canonical validation/error semantics to the internal function.
    return public.ingest_knowledge_catalog_v2_unsanitized_v5(
      p_job_id,p_knowledge_space_id,p_storage_path,p_file_name,p_mime_type,
      p_content_hash,p_raw_text,p_parser_version,p_document_type,p_objects,
      p_relations,p_warnings
    );
  end if;

  select coalesce(jsonb_agg(rel.value order by rel.ordinality), '[]'::jsonb)
    into v_relations
    from jsonb_array_elements(coalesce(p_relations,'[]'::jsonb)) with ordinality as rel(value, ordinality)
   where public.is_valid_abap_table_relation_v5(p_raw_text,p_document_type,rel.value);

  v_relation_count := jsonb_array_length(v_relations);

  -- Drop only relation-derived synthetic endpoint objects that became orphaned
  -- because their invalid relation was rejected. Real/deterministic objects are
  -- never removed, even if they are currently unrelated.
  select coalesce(jsonb_agg(obj.value order by obj.ordinality), '[]'::jsonb)
    into v_objects
    from jsonb_array_elements(coalesce(p_objects,'[]'::jsonb)) with ordinality as obj(value, ordinality)
   where not (
     coalesce((obj.value->'metadata'->>'synthetic')::boolean,false)
     and coalesce(obj.value->'metadata'->>'syntheticReason','') = 'relation_endpoint'
     and not exists (
       select 1
         from jsonb_array_elements(v_relations) rel
        where lower(coalesce(rel->>'sourceCanonicalKey','')) = lower(coalesce(obj.value->>'canonicalKey',''))
           or lower(coalesce(rel->>'targetCanonicalKey','')) = lower(coalesce(obj.value->>'canonicalKey',''))
     )
   );

  v_object_count := jsonb_array_length(v_objects);

  v_result := public.ingest_knowledge_catalog_v2_unsanitized_v5(
    p_job_id,p_knowledge_space_id,p_storage_path,p_file_name,p_mime_type,
    p_content_hash,p_raw_text,p_parser_version,p_document_type,v_objects,
    v_relations,p_warnings
  );

  return v_result || jsonb_build_object(
    'abapSqlGuardVersion','v5',
    'relationsRejectedByAbapSqlGuard', greatest(v_input_relation_count-v_relation_count,0),
    'syntheticObjectsRejectedByAbapSqlGuard', greatest(v_input_object_count-v_object_count,0)
  );
end;
$$;

revoke all on function public.ingest_knowledge_catalog_v2(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.ingest_knowledge_catalog_v2(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated, service_role;

-- Invalidate existing ABAP table relations that do not satisfy the same guard.
update public.knowledge_relations_v2 r
   set active = false,
       metadata = coalesce(r.metadata,'{}'::jsonb) || jsonb_build_object(
         'invalidatedBy','abap_sql_graph_guard_v5',
         'invalidatedReason','non_sql_abap_syntax_false_positive',
         'invalidatedAt',now()
       )
  from public.knowledge_source_versions_v2 sv
 where sv.id = r.source_version_id
   and r.active = true
   and sv.document_type = 'abap_method_archive'
   and r.relation_type in ('READS','WRITES')
   and r.target_canonical_key like 'table:%'
   and not public.is_valid_abap_table_relation_v5(
     sv.raw_text,
     sv.document_type,
     jsonb_build_object(
       'sourceCanonicalKey',r.source_canonical_key,
       'relationType',r.relation_type,
       'targetCanonicalKey',r.target_canonical_key
     )
   );

-- Archive now-orphaned placeholders only when they never received a real
-- non-synthetic version. This preserves audit/provenance while removing them
-- from published graph lookup.
update public.knowledge_objects_v2 o
   set publication_status = 'archived',
       metadata = coalesce(o.metadata,'{}'::jsonb) || jsonb_build_object(
         'invalidatedSynthetic',true,
         'invalidatedBy','abap_sql_graph_guard_v5',
         'invalidatedAt',now()
       ),
       updated_at = now()
 where coalesce((o.metadata->>'synthetic')::boolean,false)
   and o.object_type = 'table'
   and not exists (
     select 1 from public.knowledge_relations_v2 r
      where r.knowledge_space_id=o.knowledge_space_id
        and r.active=true
        and (r.source_object_id=o.id or r.target_object_id=o.id)
   )
   and not exists (
     select 1 from public.knowledge_object_versions_v2 v
      where v.object_id=o.id
        and not coalesce((v.metadata->>'synthetic')::boolean,false)
        and not coalesce((v.metadata->>'structuralEndpoint')::boolean,false)
   );

update public.knowledge_review_items_v3 q
   set status = 'resolved',
       resolved_at = now(),
       payload = coalesce(q.payload,'{}'::jsonb) || jsonb_build_object(
         'autoResolved',true,
         'resolutionReason','parser_false_positive_non_sql_abap_syntax',
         'resolvedByGuard','abap_sql_graph_guard_v5'
       )
  from public.knowledge_objects_v2 o
 where q.knowledge_space_id=o.knowledge_space_id
   and q.canonical_key=o.canonical_key
   and q.review_type='synthetic_endpoint'
   and q.status='open'
   and coalesce((o.metadata->>'invalidatedSynthetic')::boolean,false)
   and o.metadata->>'invalidatedBy'='abap_sql_graph_guard_v5';