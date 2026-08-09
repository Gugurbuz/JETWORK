import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const helperSource = readFileSync(
  new URL('../../../supabase/functions/_shared/trivialAssistantFastPath.ts', import.meta.url),
  'utf8',
);
const gatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url),
  'utf8',
);
const claimMigration = readFileSync(
  new URL('../../../supabase/migrations/20260809093000_trivial_assistant_server_fast_path.sql', import.meta.url),
  'utf8',
);
const failureMigration = readFileSync(
  new URL('../../../supabase/migrations/20260809093100_trivial_assistant_fast_path_failure.sql', import.meta.url),
  'utf8',
);
const conflictHotfixMigration = readFileSync(
  new URL('../../../supabase/migrations/20260809102000_trivial_fast_path_turn_id_conflict_hotfix.sql', import.meta.url),
  'utf8',
);

describe('trivial assistant server fast path', () => {
  it('only accepts exact conversational turns with an explicit provider model and no attachments', () => {
    expect(helperSource).toContain('TRIVIAL_CONVERSATION_PATTERN');
    expect(helperSource).toMatch(/\^\(\?:selam/);
    expect(helperSource).toContain("model === 'auto'");
    expect(helperSource).toContain('input.attachmentCount > 0');
    expect(helperSource).toContain('GEMINI_FAST_PATH_MODELS.has(model)');
    expect(helperSource).toContain('OPENAI_FAST_PATH_MODELS.has(model)');
  });

  it('routes eligible turns through one claim RPC and keeps the normal core fallback', () => {
    expect(gatewaySource).toContain("client.rpc('claim_trivial_assistant_turn'");
    expect(gatewaySource).toContain('requestTrivialAssistantResponse');
    expect(gatewaySource).toContain("client.rpc('complete_trivial_assistant_turn'");
    expect(gatewaySource).toContain("client.rpc('fail_trivial_assistant_turn'");
    expect(gatewaySource).toContain('/functions/v1/openai-assistant-core-v2');
    expect(gatewaySource).toContain("'Access-Control-Max-Age': '86400'");
    expect(gatewaySource).toContain('edgeWaitUntil(completionPromise)');
    expect(gatewaySource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(gatewaySource).not.toContain("from '../_shared/modelProviders.ts'");
  });

  it('routes only trivial Gemini Pro execution to Flash Lite while preserving truthful attribution', () => {
    expect(helperSource).toContain("TRIVIAL_GEMINI_LATENCY_MODEL = 'gemini-3.1-flash-lite-preview'");
    expect(helperSource).toContain("model === 'gemini-3.1-pro-preview' ? TRIVIAL_GEMINI_LATENCY_MODEL : model");
    expect(helperSource).toContain('executionModelForTrivialFastPathModel(input.model)');
    expect(helperSource).toContain('model: input.model');
    expect(helperSource).toContain("provider: 'gemini'");
  });

  it('uses the Gemini REST API directly so trivial turns do not load the Google SDK', () => {
    expect(helperSource).toContain('https://generativelanguage.googleapis.com/v1beta/models');
    expect(helperSource).toContain(':generateContent');
    expect(helperSource).toContain("'x-goog-api-key': input.apiKey");
    expect(helperSource).not.toContain("@google/genai");
    expect(helperSource).not.toContain('requestGeminiResponse');
  });

  it('keeps Gemini greeting tuning isolated from the shared reasoning/document provider', () => {
    expect(helperSource).toContain('maxOutputTokens: 320');
    expect(helperSource).toContain('thinkingConfig: {');
    expect(helperSource).toContain("input.model === TRIVIAL_GEMINI_LATENCY_MODEL ? 'minimal' : 'low'");
    expect(helperSource).toContain('Exact trivial turns are latency-sensitive');
  });

  it('keeps provider selection explicit without cross-provider fallback', () => {
    expect(helperSource).toContain('fallbackUsed: false');
    expect(helperSource).not.toContain('DEFAULT_GEMINI_MODEL');
    expect(helperSource).not.toContain('DEFAULT_MODEL');
  });

  it('keeps the database RPC fail-closed and authenticated-only', () => {
    expect(claimMigration).toContain('security definer');
    expect(claimMigration).toContain('auth.uid()');
    expect(claimMigration).toContain('public.is_workspace_member(p_workspace_id)');
    expect(claimMigration).toContain('public.claim_assistant_turn(');
    expect(claimMigration).toContain('grant execute on function public.claim_trivial_assistant_turn');
    expect(claimMigration).toContain('to authenticated;');
    expect(claimMigration).toContain('revoke all on function public.claim_trivial_assistant_turn');
    expect(failureMigration).toContain('public.fail_assistant_turn(');
    expect(failureMigration).toContain('turn_row.owner_id = v_owner_id');
  });

  it('preserves the canonical turn-to-conversation lock ordering', () => {
    expect(claimMigration).toContain('Lock-order invariant');
    expect(claimMigration).toContain("'fallback'::text");
    expect(claimMigration).not.toContain("set status = 'archived'");
    expect(claimMigration).toContain('Same lock order as complete_assistant_turn');
  });

  it('does not add greetings to durable substantive conversation state', () => {
    expect(claimMigration).toContain('Trivial turns deliberately do not append to durable state_items');
    expect(claimMigration).not.toContain('p_state_items');
  });

  it('targets the reasoning-run unique constraint without ambiguous turn_id resolution', () => {
    expect(conflictHotfixMigration).toContain(
      'on conflict on constraint assistant_reasoning_runs_turn_id_key do update',
    );
    expect(conflictHotfixMigration).not.toContain('on conflict (turn_id) do update');
  });
});
