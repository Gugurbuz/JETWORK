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

describe('trivial assistant server fast path', () => {
  it('only accepts exact conversational turns with an explicit provider model and no attachments', () => {
    expect(helperSource).toContain('isTrivialConversationalTurn');
    expect(helperSource).toContain("model === 'auto'");
    expect(helperSource).toContain('input.attachmentCount > 0');
    expect(helperSource).toContain('GEMINI_MODELS.has(model)');
    expect(helperSource).toContain('OPENAI_MODELS.has(model)');
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
  });

  it('keeps provider selection explicit without cross-provider fallback', () => {
    expect(helperSource).toContain("provider === 'gemini'");
    expect(helperSource).toContain('requestOpenAiTrivialResponse');
    expect(helperSource).toContain('fallbackUsed: false');
    expect(helperSource).not.toContain('DEFAULT_GEMINI_MODEL');
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

  it('does not add greetings to durable substantive conversation state', () => {
    expect(claimMigration).toContain('Trivial turns deliberately do not append to durable state_items');
    expect(claimMigration).not.toContain('p_state_items');
  });
});
