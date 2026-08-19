import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
);
const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260810231000_add_reasoning_usage_breakdown.sql', import.meta.url),
  'utf8',
);
const observabilitySource = readFileSync(
  new URL('../reasoningObservability.ts', import.meta.url),
  'utf8',
);
const debugModalSource = readFileSync(
  new URL('../../components/ReasoningDebugModal.tsx', import.meta.url),
  'utf8',
);

describe('Reasoning token budget v2', () => {
  it('deduplicates inline evidence and applies primary-agent policy before provider calls', () => {
    expect(providerSource).toContain('INTERNAL_EVIDENCE_PATTERN');
    expect(providerSource).toContain('stripDuplicatedInlineEvidence');
    expect(providerSource).toContain('sanitizeProviderInstructions');
    expect(providerSource).toContain('primaryAgentInstruction');
    expect(providerSource).toContain('openAiPrimaryAgentDeveloperItem');
  });

  it('keeps authenticated legacy per-stage token and cost telemetry available during migration', () => {
    expect(migrationSource).toContain('private.get_reasoning_usage_breakdown_internal');
    expect(migrationSource).toContain('semanticPlanner');
    expect(migrationSource).toContain('cost_guard_agent_input_tokens');
    expect(migrationSource).toContain('cost_guard_final_input_tokens');
    expect(migrationSource).toContain('grant execute on function public.get_reasoning_usage_breakdown(uuid) to authenticated');
  });

  it('keeps the existing debug UI compatible with historical stage telemetry', () => {
    expect(observabilitySource).toContain("supabase.rpc('get_reasoning_usage_breakdown'");
    expect(observabilitySource).toContain('hasStageUsageTelemetry');
    expect(observabilitySource).toContain("key.startsWith('cost_guard_agent_')");
    expect(observabilitySource).toContain("key.startsWith('cost_guard_final_')");
    expect(debugModalSource).toContain('Token / maliyet kırılımı');
    expect(debugModalSource).toContain('Semantic planner');
    expect(debugModalSource).toContain('Agent kararları');
    expect(debugModalSource).toContain('Final synthesis');
    expect(debugModalSource).toContain('Combined');
    expect(debugModalSource).toContain('runtime token');
  });
});
