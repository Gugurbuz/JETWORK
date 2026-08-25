-- Make generated assistant files durable at the turn boundary. A file that has
-- reached assistant-files storage is a successful side effect and must survive
-- stream disconnects, page reloads, and stale-turn recovery without executing
-- the file tool a second time.

create table if not exists public.assistant_turn_artifacts (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references public.assistant_turns(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  workspace_id text not null,
  owner_id uuid not null,
  attachment_id text not null,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  storage_bucket text not null default 'assistant-files',
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index if not exists assistant_turn_artifacts_turn_created_idx
  on public.assistant_turn_artifacts(turn_id, created_at desc);
create index if not exists assistant_turn_artifacts_workspace_owner_idx
  on public.assistant_turn_artifacts(workspace_id, owner_id, created_at desc);

alter table public.assistant_turn_artifacts enable row level security;

create or replace function public.capture_assistant_turn_artifact()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  path_parts text[];
  artifact_owner uuid;
  artifact_workspace text;
  artifact_attachment_id text;
  artifact_name text;
  artifact_mime text;
  turn_record public.assistant_turns%rowtype;
begin
  if new.bucket_id <> 'assistant-files' or new.name not like '%/outputs/%' then
    return new;
  end if;

  path_parts := string_to_array(new.name, '/');
  if coalesce(array_length(path_parts, 1), 0) < 5 or path_parts[3] <> 'outputs' then
    return new;
  end if;

  begin
    artifact_owner := path_parts[1]::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  artifact_workspace := left(coalesce(path_parts[2], ''), 240);
  artifact_attachment_id := left(coalesce(path_parts[4], ''), 240);
  artifact_name := left(array_to_string(path_parts[5:array_length(path_parts, 1)], '/'), 500);
  artifact_mime := left(coalesce(new.metadata ->> 'mimetype', 'application/octet-stream'), 240);

  if artifact_workspace = '' or artifact_attachment_id = '' or artifact_name = '' then
    return new;
  end if;

  -- Prefer the conversation lock: it is the authoritative owner of side effects
  -- produced by the currently executing assistant request.
  select turn_row.*
    into turn_record
    from public.assistant_conversations conversation_row
    join public.assistant_turns turn_row on turn_row.id = conversation_row.locked_turn_id
   where conversation_row.workspace_id = artifact_workspace
     and conversation_row.owner_id = artifact_owner
     and conversation_row.status = 'active'
     and turn_row.status = 'running'
   order by turn_row.updated_at desc
   limit 1;

  -- Fallback only for the narrow race where the storage commit wins immediately
  -- before the conversation lock is visible to the trigger transaction.
  if turn_record.id is null then
    select turn_row.*
      into turn_record
      from public.assistant_turns turn_row
     where turn_row.workspace_id = artifact_workspace
       and turn_row.owner_id = artifact_owner
       and turn_row.status = 'running'
       and turn_row.updated_at >= now() - interval '10 minutes'
     order by turn_row.updated_at desc
     limit 1;
  end if;

  if turn_record.id is null then
    return new;
  end if;

  insert into public.assistant_turn_artifacts (
    turn_id, conversation_id, workspace_id, owner_id,
    attachment_id, name, mime_type, storage_bucket, storage_path, created_at
  ) values (
    turn_record.id, turn_record.conversation_id, artifact_workspace, artifact_owner,
    artifact_attachment_id, artifact_name, artifact_mime, new.bucket_id, new.name, coalesce(new.created_at, now())
  )
  on conflict (storage_bucket, storage_path) do update
    set attachment_id = excluded.attachment_id,
        name = excluded.name,
        mime_type = excluded.mime_type;

  -- A committed file is meaningful progress. Keep the lease alive while the
  -- model writes its short final response, so a reconnect cannot reclaim the
  -- turn in the middle of artifact delivery.
  update public.assistant_turns
     set updated_at = now()
   where id = turn_record.id and status = 'running';

  update public.assistant_conversations
     set lock_expires_at = greatest(coalesce(lock_expires_at, now()), now() + interval '3 minutes'),
         updated_at = now()
   where id = turn_record.conversation_id
     and locked_turn_id = turn_record.id;

  return new;
end;
$function$;

-- Storage inserts are the durable boundary for every executor (DOCX/XLSX/PDF/PPTX),
-- so this works for old and new assistant cores without model-specific code.
drop trigger if exists capture_assistant_turn_artifact_after_insert on storage.objects;
create trigger capture_assistant_turn_artifact_after_insert
after insert on storage.objects
for each row execute function public.capture_assistant_turn_artifact();

-- Backfill recent outputs that were produced before this trigger existed. Associate
-- only close-in-time turns; this intentionally avoids guessing for old manual repairs.
with stored as (
  select
    object_row.name as storage_path,
    object_row.bucket_id as storage_bucket,
    object_row.created_at,
    object_row.metadata,
    split_part(object_row.name, '/', 1)::uuid as owner_id,
    split_part(object_row.name, '/', 2) as workspace_id,
    split_part(object_row.name, '/', 4) as attachment_id,
    regexp_replace(object_row.name, '^[^/]+/[^/]+/outputs/[^/]+/', '') as artifact_name
  from storage.objects object_row
  where object_row.bucket_id = 'assistant-files'
    and object_row.name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+/outputs/[^/]+/.+'
    and object_row.created_at >= now() - interval '30 days'
), matched as (
  select stored.*, turn_row.id as turn_id, turn_row.conversation_id
  from stored
  cross join lateral (
    select candidate.id, candidate.conversation_id
    from public.assistant_turns candidate
    where candidate.workspace_id = stored.workspace_id
      and candidate.owner_id = stored.owner_id
      and candidate.created_at <= stored.created_at + interval '2 minutes'
      and candidate.created_at >= stored.created_at - interval '6 hours'
    order by candidate.created_at desc
    limit 1
  ) turn_row
)
insert into public.assistant_turn_artifacts (
  turn_id, conversation_id, workspace_id, owner_id,
  attachment_id, name, mime_type, storage_bucket, storage_path, created_at
)
select
  matched.turn_id,
  matched.conversation_id,
  matched.workspace_id,
  matched.owner_id,
  matched.attachment_id,
  left(matched.artifact_name, 500),
  left(coalesce(matched.metadata ->> 'mimetype', 'application/octet-stream'), 240),
  matched.storage_bucket,
  matched.storage_path,
  matched.created_at
from matched
on conflict (storage_bucket, storage_path) do nothing;

create or replace function public.get_assistant_turn_artifacts(
  p_workspace_id text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller_id uuid := auth.uid();
  selected_turn_id uuid;
  result jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication is required';
  end if;

  select turn_row.id
    into selected_turn_id
    from public.assistant_turns turn_row
   where turn_row.workspace_id = p_workspace_id
     and turn_row.owner_id = caller_id
     and (
       turn_row.message_id = left(coalesce(p_message_id, ''), 240)
       or turn_row.message_id like left(coalesce(p_message_id, ''), 175) || ':%'
     )
   order by
     case when turn_row.message_id = left(coalesce(p_message_id, ''), 240) then 0 else 1 end,
     turn_row.created_at desc
   limit 1;

  if selected_turn_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId', artifact.attachment_id,
    'name', artifact.name,
    'mimeType', artifact.mime_type,
    'storageBucket', artifact.storage_bucket,
    'storagePath', artifact.storage_path,
    'purpose', 'tool_output'
  ) order by artifact.created_at desc), '[]'::jsonb)
  into result
  from (
    -- A retry can produce the same file type twice. Expose only the newest one
    -- for each MIME type while retaining multi-format outputs from one turn.
    select distinct on (coalesce(nullif(mime_type, ''), name)) *
    from public.assistant_turn_artifacts
    where turn_id = selected_turn_id
    order by coalesce(nullif(mime_type, ''), name), created_at desc
  ) artifact;

  return coalesce(result, '[]'::jsonb);
end;
$function$;

grant execute on function public.get_assistant_turn_artifacts(text, text) to authenticated;

create or replace function public.claim_assistant_turn(
  p_conversation_id uuid,
  p_workspace_id text,
  p_owner_id uuid,
  p_prompt_version_id uuid,
  p_message_id text,
  p_request_hash text,
  p_user_limit_per_minute integer,
  p_workspace_limit_per_minute integer
)
returns table(
  outcome text,
  turn_id uuid,
  response_text text,
  source_refs jsonb,
  usage jsonb,
  response_model text,
  lease_token uuid
)
language plpgsql
set search_path to ''
as $function$
declare
  turn_record public.assistant_turns%rowtype;
  conversation_snapshot public.assistant_conversations%rowtype;
  conversation_record public.assistant_conversations%rowtype;
  locked_turn public.assistant_turns%rowtype;
  user_turn_count integer;
  workspace_turn_count integer;
  effective_message_id text := left(coalesce(p_message_id, ''), 240);
  incoming_message_at timestamptz;
  locked_message_at timestamptz;
  snapshot_locked_turn_id uuid;
  locked_turn_has_artifact boolean := false;
  turn_has_artifact boolean := false;
begin
  if effective_message_id = '' or coalesce(p_request_hash, '') = '' then
    raise exception 'Assistant message id and request hash are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id || ':' || p_owner_id::text, 0));

  select * into conversation_snapshot
  from public.assistant_conversations conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.workspace_id = p_workspace_id
    and conversation_row.status = 'active';

  if conversation_snapshot.id is null or conversation_snapshot.prompt_version_id <> p_prompt_version_id then
    raise exception 'Assistant conversation is not available for this prompt version';
  end if;

  snapshot_locked_turn_id := conversation_snapshot.locked_turn_id;

  if snapshot_locked_turn_id is not null then
    select * into locked_turn
    from public.assistant_turns turn_row
    where turn_row.id = snapshot_locked_turn_id
    for update;

    select exists(select 1 from public.assistant_turn_artifacts artifact where artifact.turn_id = locked_turn.id)
      into locked_turn_has_artifact;
  end if;

  select * into conversation_record
  from public.assistant_conversations conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.workspace_id = p_workspace_id
    and conversation_row.status = 'active'
  for update;

  if conversation_record.id is null or conversation_record.prompt_version_id <> p_prompt_version_id then
    raise exception 'Assistant conversation is not available for this prompt version';
  end if;

  if conversation_record.locked_turn_id is distinct from snapshot_locked_turn_id
     and conversation_record.locked_turn_id is not null then
    return query select 'busy'::text, null::uuid, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
    return;
  end if;

  if conversation_record.locked_turn_id is not null
     and locked_turn.id is not null
     and locked_turn.id <> (
       select candidate.id
       from public.assistant_turns candidate
       where candidate.workspace_id = p_workspace_id
         and candidate.owner_id = p_owner_id
         and candidate.message_id = effective_message_id
       limit 1
     ) then

    if conversation_record.lock_expires_at <= now() or locked_turn.status <> 'running' then
      if locked_turn.status = 'running' then
        if locked_turn_has_artifact then
          update public.assistant_turns
             set status = 'completed',
                 response_text = coalesce(nullif(response_text, ''), 'Dosya oluşturuldu ve hazır.'),
                 usage = coalesce(usage, '{}'::jsonb) || jsonb_build_object('artifact_recovered_without_reexecution', 1),
                 response_model = coalesce(response_model, conversation_record.model),
                 error_message = null,
                 completed_at = coalesce(completed_at, now()),
                 updated_at = now()
           where id = locked_turn.id;
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'completed',
                 error_message = null,
                 completed_at = coalesce(reasoning_run.completed_at, now()),
                 updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        else
          update public.assistant_turns
             set status = 'failed',
                 error_message = 'stale_lock_reclaimed',
                 completed_at = now(),
                 updated_at = now()
           where id = locked_turn.id;
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'failed',
                 error_message = 'stale_lock_reclaimed',
                 completed_at = coalesce(reasoning_run.completed_at, now()),
                 updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        end if;
      end if;
      update public.assistant_conversations
         set locked_turn_id = null, lock_expires_at = null, updated_at = now()
       where id = p_conversation_id and locked_turn_id = locked_turn.id;
      conversation_record.locked_turn_id := null;
      conversation_record.lock_expires_at := null;
    else
      select message_row.created_at into incoming_message_at
      from public.messages message_row
      where message_row.workspace_id = p_workspace_id and message_row.id = p_message_id
      limit 1;

      select message_row.created_at into locked_message_at
      from public.messages message_row
      where message_row.workspace_id = p_workspace_id
        and (message_row.id = locked_turn.message_id or locked_turn.message_id like message_row.id || ':%')
      order by case when message_row.id = locked_turn.message_id then 0 else 1 end, message_row.created_at desc
      limit 1;

      if incoming_message_at is not null and locked_message_at is not null and incoming_message_at > locked_message_at then
        if locked_turn_has_artifact then
          update public.assistant_turns
             set status = 'completed',
                 response_text = coalesce(nullif(response_text, ''), 'Dosya oluşturuldu ve hazır.'),
                 usage = coalesce(usage, '{}'::jsonb) || jsonb_build_object('artifact_recovered_without_reexecution', 1),
                 response_model = coalesce(response_model, conversation_record.model),
                 error_message = null,
                 completed_at = coalesce(completed_at, now()),
                 updated_at = now()
           where id = locked_turn.id and status = 'running';
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'completed', error_message = null,
                 completed_at = coalesce(reasoning_run.completed_at, now()), updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        else
          update public.assistant_turns
             set status = 'failed',
                 error_message = 'superseded_by_newer_message:' || left(p_message_id, 240),
                 completed_at = now(), updated_at = now()
           where id = locked_turn.id and status = 'running';
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'failed',
                 error_message = 'superseded_by_newer_message:' || left(p_message_id, 240),
                 completed_at = coalesce(reasoning_run.completed_at, now()), updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        end if;

        update public.assistant_conversations
           set locked_turn_id = null, lock_expires_at = null, updated_at = now()
         where id = p_conversation_id and locked_turn_id = locked_turn.id;
        conversation_record.locked_turn_id := null;
        conversation_record.lock_expires_at := null;
      else
        return query select 'busy'::text, locked_turn.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
        return;
      end if;
    end if;
  end if;

  select * into turn_record
  from public.assistant_turns turn_row
  where turn_row.workspace_id = p_workspace_id
    and turn_row.owner_id = p_owner_id
    and turn_row.message_id = effective_message_id
  for update;

  if turn_record.id is not null and turn_record.request_hash <> p_request_hash then
    effective_message_id := left(p_message_id, 175) || ':' || p_request_hash;
    select * into turn_record
    from public.assistant_turns turn_row
    where turn_row.workspace_id = p_workspace_id
      and turn_row.owner_id = p_owner_id
      and turn_row.message_id = effective_message_id
    for update;
  end if;

  if turn_record.id is null then
    select count(*)::integer into user_turn_count
    from public.assistant_turns turn_row
    where turn_row.owner_id = p_owner_id and turn_row.created_at >= now() - interval '1 minute';

    select count(*)::integer into workspace_turn_count
    from public.assistant_turns turn_row
    where turn_row.workspace_id = p_workspace_id and turn_row.created_at >= now() - interval '1 minute';

    if user_turn_count >= greatest(1, least(p_user_limit_per_minute, 60))
       or workspace_turn_count >= greatest(1, least(p_workspace_limit_per_minute, 240)) then
      return query select 'rate_limited'::text, null::uuid, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
      return;
    end if;

    insert into public.assistant_turns (
      conversation_id, workspace_id, owner_id, prompt_version_id, message_id, request_hash
    ) values (
      p_conversation_id, p_workspace_id, p_owner_id, p_prompt_version_id, effective_message_id, p_request_hash
    )
    on conflict (workspace_id, owner_id, message_id) do nothing
    returning * into turn_record;

    if turn_record.id is null then
      select * into turn_record
      from public.assistant_turns turn_row
      where turn_row.workspace_id = p_workspace_id
        and turn_row.owner_id = p_owner_id
        and turn_row.message_id = effective_message_id
      for update;
    end if;
  end if;

  if turn_record.id is null then raise exception 'Assistant turn could not be created'; end if;
  if turn_record.request_hash <> p_request_hash then raise exception 'Assistant idempotency key conflict'; end if;

  if turn_record.status = 'completed' then
    return query select 'completed'::text, turn_record.id, turn_record.response_text,
      turn_record.source_refs, turn_record.usage, turn_record.response_model, null::uuid;
    return;
  end if;

  select exists(select 1 from public.assistant_turn_artifacts artifact where artifact.turn_id = turn_record.id)
    into turn_has_artifact;

  if turn_has_artifact then
    update public.assistant_turns
       set status = 'completed',
           response_text = coalesce(nullif(response_text, ''), 'Dosya oluşturuldu ve hazır.'),
           usage = coalesce(usage, '{}'::jsonb) || jsonb_build_object('artifact_recovered_without_reexecution', 1),
           response_model = coalesce(response_model, conversation_record.model),
           error_message = null,
           completed_at = coalesce(completed_at, now()),
           updated_at = now()
     where id = turn_record.id
     returning * into turn_record;

    update public.assistant_reasoning_runs as reasoning_run
       set status = 'completed', error_message = null,
           completed_at = coalesce(reasoning_run.completed_at, now()), updated_at = now()
     where reasoning_run.turn_id = turn_record.id and reasoning_run.status = 'running';

    update public.assistant_conversations
       set locked_turn_id = null,
           lock_expires_at = null,
           revision = revision + 1,
           updated_at = now()
     where id = p_conversation_id
       and (locked_turn_id = turn_record.id or locked_turn_id is null);

    return query select 'completed'::text, turn_record.id, turn_record.response_text,
      turn_record.source_refs, turn_record.usage, turn_record.response_model, null::uuid;
    return;
  end if;

  if turn_record.status = 'running' and turn_record.updated_at >= now() - interval '3 minutes' then
    return query select 'in_progress'::text, turn_record.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
    return;
  end if;

  update public.assistant_turns
     set status = 'running', attempt_count = attempt_count + 1,
         lease_token = gen_random_uuid(), error_message = null,
         completed_at = null, updated_at = now()
   where id = turn_record.id
   returning * into turn_record;

  update public.assistant_conversations
     set locked_turn_id = turn_record.id,
         lock_expires_at = now() + interval '3 minutes', updated_at = now()
   where id = p_conversation_id;

  return query select 'claimed'::text, turn_record.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, turn_record.lease_token;
end;
$function$;
