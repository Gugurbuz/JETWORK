alter table public.assistant_prompt_versions
  drop constraint if exists assistant_prompt_versions_model_check;

alter table public.assistant_prompt_versions
  add constraint assistant_prompt_versions_model_check
  check (
    model in (
      'gpt-5.6-sol',
      'gpt-5.6',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite-preview'
    )
  );

alter table public.assistant_conversations
  drop constraint if exists assistant_conversations_model_check;

alter table public.assistant_conversations
  add constraint assistant_conversations_model_check
  check (
    model in (
      'gpt-5.6-sol',
      'gpt-5.6',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite-preview'
    )
  );
