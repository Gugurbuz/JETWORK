import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('V5 capability disclosure latency budget', () => {
  it('keeps disclosure measurable without imposing a turn-wide semantic ceiling', () => {
    expect(coreSource).toContain('let capabilityDisclosureCalls = 0')
    expect(coreSource).toContain('capabilityDisclosureCalls += 1')
    expect(coreSource).toContain('capability_disclosure_control_calls: 1')
    expect(coreSource).not.toContain('MAX_CAPABILITY_DISCLOSURE_CALLS')
    expect(coreSource).not.toContain('TOOL_BUDGET_EXHAUSTED')
  })

  it('bounds physical runtime time instead of semantic controller depth', () => {
    expect(coreSource).not.toContain('MAX_TOOL_ROUNDS')
    expect(coreSource).not.toContain('maxControllerRound')
    expect(coreSource).toContain('for (let round = 0; !runController.signal.aborted; round += 1)')
    expect(coreSource).toContain('remainingRunMs')
    expect(coreSource).toContain('FINAL_SYNTHESIS_RESERVE_MS')
    expect(coreSource).toContain('Fiziksel run süresinin son güvenlik rezervine girildi')
  })

  it('keeps the latency boundary mechanical rather than semantic', () => {
    expect(coreSource).not.toContain('LRT_CONTROL_PLANE')
    expect(coreSource).not.toContain('CHECK_LRTV3_CONTROL')
    expect(coreSource).not.toContain("if (query.includes('LRT'))")
  })
})
