create index if not exists assistant_reasoning_runs_conversation_idx
  on public.assistant_reasoning_runs(conversation_id);

create index if not exists assistant_reasoning_runs_prompt_version_idx
  on public.assistant_reasoning_runs(prompt_version_id)
  where prompt_version_id is not null;
