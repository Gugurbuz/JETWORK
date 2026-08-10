-- Keep persisted assistant model constraints aligned with the runtime provider catalog.
-- gemini-3.5-flash is the same-provider stable fallback used by Reasoning Engine v3.

alter table public.assistant_conversations
  drop constraint if exists assistant_conversations_model_check;

alter table public.assistant_conversations
  add constraint assistant_conversations_model_check
  check (
    model = any (array[
      'gpt-5.6-sol'::text,
      'gpt-5.6'::text,
      'gemini-3-flash-preview'::text,
      'gemini-3.1-pro-preview'::text,
      'gemini-3.1-flash-lite-preview'::text,
      'gemini-3.5-flash'::text
    ])
  );

alter table public.assistant_prompt_versions
  drop constraint if exists assistant_prompt_versions_model_check;

alter table public.assistant_prompt_versions
  add constraint assistant_prompt_versions_model_check
  check (
    model = any (array[
      'gpt-5.6-sol'::text,
      'gpt-5.6'::text,
      'gemini-3-flash-preview'::text,
      'gemini-3.1-pro-preview'::text,
      'gemini-3.1-flash-lite-preview'::text,
      'gemini-3.5-flash'::text
    ])
  );
