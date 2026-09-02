import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  shouldUseTrivialAssistantFastPath,
} from '../../../supabase/functions/_shared/trivialAssistantFastPath';

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
const completionModelAllowlistMigration = readFileSync(
  new URL('../../../supabase/migrations/20260812002000_allow_trivial_fast_path_latency_models.sql', import.meta.url),
  'utf8',
);

describe('trivial assistant server fast path', () => {
  it('keeps exact conversational turns eligible for legacy auto routing even when stale attachment state exists', () => {
    expect(helperSource).toContain('TRIVIAL_CONVERSATION_PATTERN');
    expect(helperSource).toMatch(/\^\(\?:selam/);
    expect(helperSource).toContain("model !== 'auto'");
    expect(helperSource).not.toContain("model === 'auto' || input.attachmentCount > 0");
    expect(helperSource).toContain("model === 'auto' || GEMINI_FAST_PATH_MODELS.has(model)");
    expect(helperSource).toContain("model === 'auto' || model === 'gemini-3.1-pro-preview'");
    expect(shouldUseTrivialAssistantFastPath({
      message: 'merhaba',
      model: 'auto',
      attachmentCount: 3,
      agentControllerV2Enabled: false,
    })).toBe(true);
  });

  it('uses exact deterministic greeting responses instead of culturally expanding the greeting', () => {
    expect(helperSource).toContain("['selam', 'Selam! Nasıl yardımcı olabilirim?']");
    expect(helperSource).toContain("['merhaba', 'Merhaba! Nasıl yardımcı olabilirim?']");
    expect(helperSource).toContain("['selamun aleykum', 'Aleykümselam! Nasıl yardımcı olabilirim?']");
    expect(helperSource).toContain('deterministicTrivialResponseForMessage(input.message)');
    expect(helperSource).toContain('usage: { deterministic_fast_path: 1 }');
    expect(helperSource).toContain('Selamlaşma biçimini yalnız mevcut mesaj belirler');
    expect(helperSource).toContain('"nasılsın" veya "naber" için bunu kullanma');
  });

  it('isolates a narrow noisy casual extension from substantive enterprise requests', () => {
    expect(helperSource).toContain('NOISY_CONVERSATIONAL_EXTENSION_PATTERN');
    expect(helperSource).toContain('MIN_NOISY_EXTENSION_LENGTH = 10');
    expect(helperSource).toContain('MAX_NOISY_EXTENSION_LENGTH = 64');
    expect(helperSource).toContain('if (attachmentCount > 0) return false');
    expect(helperSource).toContain('isNoisyConversationalExtension(normalized, input.attachmentCount)');
    expect(helperSource).toContain('yalnızca mevcut kullanıcı mesajını bağlam kabul et');
    expect(helperSource).toContain('klavye testi, teknik konu, önceki soru ya da başka bir kullanıcı amacı uydurma');
    expect(shouldUseTrivialAssistantFastPath({
      message: 'merhaba abcdefghijklmnop',
      model: 'auto',
      attachmentCount: 0,
      agentControllerV2Enabled: false,
    })).toBe(true);
    expect(shouldUseTrivialAssistantFastPath({
      message: 'merhaba sap crm hata',
      model: 'auto',
      attachmentCount: 0,
      agentControllerV2Enabled: false,
    })).toBe(false);
  });

  it('routes eligible legacy turns through one claim RPC and keeps the normal core fallback', () => {
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

  it('routes trivial Gemini Pro, auto, and retired preview execution to stable Flash Lite', () => {
    expect(helperSource).toContain("TRIVIAL_GEMINI_LATENCY_MODEL = 'gemini-3.1-flash-lite'");
    expect(helperSource).toContain("DEPRECATED_GEMINI_FLASH_LITE_PREVIEW = 'gemini-3.1-flash-lite-preview'");
    expect(helperSource).toContain("model === 'auto' || model === 'gemini-3.1-pro-preview'");
    expect(helperSource).toContain('executionModelForTrivialFastPathModel(input.model)');
    expect(helperSource).toContain('model: input.model');
    expect(helperSource).toContain("provider: 'gemini'");
  });

  it('uses the Gemini REST API directly so non-deterministic trivial turns do not load the Google SDK', () => {
    expect(helperSource).toContain('https://generativelanguage.googleapis.com/v1beta/models');
    expect(helperSource).toContain(':generateContent');
    expect(helperSource).toContain("'x-goog-api-key': input.apiKey");
    expect(helperSource).not.toContain("@google/genai");
    expect(helperSource).not.toContain('requestGeminiResponse');
  });

  it('keeps Gemini greeting tuning cheap only on the legacy lane', () => {
    expect(helperSource).toContain('maxOutputTokens: 160');
    expect(helperSource).toContain('thinkingConfig: {');
    expect(helperSource).toContain("? 'minimal'");
    expect(shouldUseTrivialAssistantFastPath({
      message: 'merhaba',
      model: 'auto',
      attachmentCount: 0,
      agentControllerV2Enabled: true,
    })).toBe(false);
  });

  it('keeps provider isolation for explicit model selection while allowing auto to choose a low-cost provider', () => {
    expect(helperSource).toContain('fallbackUsed: false');
    expect(helperSource).not.toContain('DEFAULT_GEMINI_MODEL');
    expect(helperSource).not.toContain('DEFAULT_MODEL');
    expect(helperSource).toContain("if (input.model === 'auto' && input.openAiApiKey)");
  });

  it('keeps context-sensitive acknowledgements out of the context-free fast path at the gateway', () => {
    expect(gatewaySource).toContain("CONTEXT_SENSITIVE_ACKNOWLEDGEMENTS = new Set(['tamam', 'ok', 'okay'])");
    expect(gatewaySource).toContain('CONTEXT_SENSITIVE_ACKNOWLEDGEMENTS.has(normalizeShortText(message))');
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

  it('allows every runtime trivial fast-path response model at DB completion', () => {
    expect(completionModelAllowlistMigration).toContain("'gemini-3.1-flash-lite'");
    expect(completionModelAllowlistMigration).toContain("'gemini-3.5-flash'");
    expect(completionModelAllowlistMigration).toContain("'gemini-3.5-flash-lite'");
    expect(completionModelAllowlistMigration).toContain("invalid_fast_path_completion");
    expect(completionModelAllowlistMigration).not.toContain("'auto'");
  });
});