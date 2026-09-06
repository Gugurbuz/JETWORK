import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260906015000_gemini_38_trivial_fast_path.sql', import.meta.url),
  'utf8',
);
const helper = readFileSync(
  new URL('../../../supabase/functions/_shared/trivialAssistantFastPath.ts', import.meta.url),
  'utf8',
);
const messageRepository = readFileSync(
  new URL('../messageRepository.ts', import.meta.url),
  'utf8',
);
const indexHtml = readFileSync(
  new URL('../../../index.html', import.meta.url),
  'utf8',
);

describe('trivial fast path DB/runtime contract regression', () => {
  it('accepts auto and stale Gemini aliases but normalizes execution to Gemini 3.8 Flash', () => {
    expect(helper).toContain("TRIVIAL_GEMINI_LATENCY_MODEL = 'gemini-3.8-flash'");
    expect(helper).toContain("model === 'auto'");
    expect(migration).toContain("when p_model = 'auto' or p_model like 'gemini-%' then 'gemini-3.8-flash'");
    expect(migration).toContain("'auto',");
    expect(migration).toContain("'gemini-3.8-flash'");
    expect(migration).toContain("'gemini-3.5-flash'");
    expect(migration).toContain('v_execution_model');
  });

  it('does not reject a context-free greeting because the active conversation uses another model', () => {
    expect(migration).not.toContain('v_conversation.model <> p_model');
    expect(migration).not.toContain('v_conversation.model <> v_execution_model');
    expect(migration).toContain('v_conversation.prompt_version_id <> v_prompt_id');
    expect(migration).toContain('Trivial turns deliberately reuse the active conversation');
  });

  it('allows only the active Gemini 3.8 model at trivial completion', () => {
    const completionStart = migration.indexOf('create or replace function public.complete_trivial_assistant_turn');
    const completion = migration.slice(completionStart);
    expect(completion).toContain("'gemini-3.8-flash'");
    expect(completion).not.toContain("'gemini-3.5-flash'");
    expect(completion).not.toContain("'gemini-3.1-flash-lite'");
    expect(completion).toContain('invalid_fast_path_completion');
  });

  it('keeps the exact deterministic greeting response in the runtime helper', () => {
    expect(helper).toContain("['selam', 'Selam! Nasıl yardımcı olabilirim?']");
    expect(helper).toContain('deterministicTrivialResponseForMessage(input.message)');
    expect(helper).toContain('usage: { deterministic_fast_path: 1 }');
  });

  it('keeps provider/model telemetry out of durable single-runtime chat messages', () => {
    expect(messageRepository).toContain('provider: hidesPrivateRuntimeTelemetry ? null : message.provider');
    expect(messageRepository).toContain('response_model: hidesPrivateRuntimeTelemetry ? null : message.responseModel');
    expect(messageRepository).toContain('fallback_used: hidesPrivateRuntimeTelemetry ? false : message.fallbackUsed');
  });

  it('hides historical provider badges from the normal chat surface', () => {
    expect(indexHtml).toContain('.chat-scroll-container [title="openai"]');
    expect(indexHtml).toContain('.chat-scroll-container [title^="gpt-"]');
    expect(indexHtml).toContain('.chat-scroll-container [title^="gemini-"]');
  });
});
