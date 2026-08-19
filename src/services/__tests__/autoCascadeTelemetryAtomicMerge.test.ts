import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260819131500_preserve_auto_cascade_telemetry_on_concurrent_updates.sql', import.meta.url),
  'utf8',
)

describe('Auto cascade telemetry concurrent update protection', () => {
  it('scopes usage preservation to Auto cascade turns', () => {
    expect(migration).toContain("v_old ? 'auto_model_cascade_started'")
    expect(migration).toContain("v_new ? 'auto_model_cascade_started'")
    expect(migration).toContain('before update of usage on public.assistant_turns')
  })

  it('preserves cumulative provider and router counters monotonically', () => {
    expect(migration).toContain("'input_tokens'")
    expect(migration).toContain("'estimated_cost_usd'")
    expect(migration).toContain("'primary_llm_agent_calls'")
    expect(migration).toContain("'primary_llm_router_calls'")
    expect(migration).toContain('greatest(v_old_number, v_new_number)')
  })

  it('keeps routing attribution and stream timing from overwriting each other', () => {
    expect(migration).toContain("v_old ? 'autoModelCascade'")
    expect(migration).toContain("v_new ? 'autoModelCascade'")
    expect(migration).toContain('new.evidence_summary := v_old || v_new')
  })
})
