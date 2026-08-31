-- Allow the explicitly selectable local Ollama model to be persisted by the assistant runtime.
-- Keep the existing provider catalog intact and add only the self-hosted Qwen model.

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
      'gemini-3.1-flash-lite'::text,
      'gemini-3.5-flash'::text,
      'gemini-3.5-flash-lite'::text,
      'ollama:qwen3:4b-instruct'::text
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
      'gemini-3.1-flash-lite'::text,
      'gemini-3.5-flash'::text,
      'gemini-3.5-flash-lite'::text,
      'ollama:qwen3:4b-instruct'::text
    ])
  );
