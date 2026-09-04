import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const messagesHookSource = readFileSync(
  new URL('../../hooks/useMessages.ts', import.meta.url),
  'utf8',
);
const gatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url),
  'utf8',
);
const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
);
const preservationMigration = readFileSync(
  new URL('../../../supabase/migrations/20260809113000_preserve_trivial_requested_model.sql', import.meta.url),
  'utf8',
);

describe('assistant requested model consistency', () => {
  it('snapshots the latest model from the Zustand store at the send boundary', () => {
    expect(messagesHookSource).toContain(
      "const requestedModel = useSettingsStore.getState().selectedModel || 'auto';",
    );
    expect(messagesHookSource).not.toContain(
      'const selectedModel = useSettingsStore(state => state.selectedModel);',
    );
    expect(messagesHookSource.match(/model: requestedModel/g)?.length || 0).toBeGreaterThanOrEqual(2);
  });

  it('traces the requested model through the gateway and distinguishes the response model', () => {
    expect(gatewaySource).toContain("logLatency('ASSISTANT_GATEWAY_REQUEST'");
    expect(gatewaySource).toContain('requestedModel,');
    expect(gatewaySource).toContain('requestedModel: model,');
    expect(gatewaySource).toContain('responseModel: result.model,');
    expect(gatewaySource).toContain("logLatency('ASSISTANT_TRIVIAL_FAST_PATH_COMPLETE'");
  });

  it('persists requested/configured/response model attribution in core reasoning telemetry', () => {
    expect(coreSource).toContain("console.info('ASSISTANT_MODEL_SELECTION'");
    expect(coreSource).toContain('requestedModel,');
    expect(coreSource).toContain('configuredModel,');
    expect(coreSource).toContain('responseModel,');
    expect(coreSource).toContain(
      'evidence_summary: { requestedModel: input.requestedModel, configuredModel: input.configuredModel, controllerMode: AGENTIC_CONTROLLER_ENABLED },',
    );
  });

  it('preserves the requested conversation model when a trivial turn executes on another model', () => {
    expect(preservationMigration).toContain(
      'update public.assistant_conversations\n     set revision = revision + 1,',
    );
    expect(preservationMigration).not.toContain(
      'set model = p_response_model,\n         revision = revision + 1',
    );
    expect(preservationMigration).toContain('response_model = p_response_model');
    expect(preservationMigration).toContain("'requestedModel', v_conversation.model");
    expect(preservationMigration).toContain("'responseModel', p_response_model");
  });

  it('keeps completion security and canonical lock ordering intact', () => {
    expect(preservationMigration).toContain('security definer');
    expect(preservationMigration).toContain('auth.uid()');
    expect(preservationMigration).toContain('turn first, conversation second');
    expect(preservationMigration).toContain(
      'grant execute on function public.complete_trivial_assistant_turn',
    );
    expect(preservationMigration).toContain('to authenticated;');
  });
});
