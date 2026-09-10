import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('V5 capability disclosure latency budget', () => {
  it('keeps disclosure separate from substantive tool calls but caps navigation tightly', () => {
    expect(coreSource).toContain("MAX_CAPABILITY_DISCLOSURE_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS', 3, 1, 6)")
    expect(coreSource).toContain('let capabilityDisclosureCalls = 0')
    expect(coreSource).toContain('capabilityDisclosureCalls += 1')
    expect(coreSource).toContain('capability_disclosure_control_calls: 1')
    expect(coreSource).toContain('toolName !== DISCOVER_MORE_CAPABILITIES_TOOL_NAME && totalToolCalls >= MAX_TOOL_CALLS')
  })

  it('never grants disclosure-only rounds extra model calls beyond the normal controller budget', () => {
    expect(coreSource).toContain('let maxControllerRound = MAX_TOOL_ROUNDS')
    expect(coreSource).not.toContain('let disclosureControlRounds = 0')
    expect(coreSource).not.toContain('maxControllerRound = Math.min(MAX_TOOL_ROUNDS + MAX_CAPABILITY_DISCLOSURE_CALLS')
    expect(coreSource).not.toContain('capability_disclosure_control_rounds: 1')
  })

  it('keeps the latency boundary mechanical rather than semantic', () => {
    expect(coreSource).not.toContain('LRT_CONTROL_PLANE')
    expect(coreSource).not.toContain('CHECK_LRTV3_CONTROL')
    expect(coreSource).not.toContain("if (query.includes('LRT'))")
  })
})
