import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('V5 capability disclosure control-plane budget', () => {
  it('keeps disclosure calls out of the substantive tool-call budget', () => {
    expect(coreSource).toContain("MAX_CAPABILITY_DISCLOSURE_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS', 8, 3, 12)")
    expect(coreSource).toContain('let capabilityDisclosureCalls = 0')
    expect(coreSource).toContain('capabilityDisclosureCalls += 1')
    expect(coreSource).toContain('capability_disclosure_control_calls: 1')
    expect(coreSource).toContain('toolName !== DISCOVER_MORE_CAPABILITIES_TOOL_NAME && totalToolCalls >= MAX_TOOL_CALLS')

    const start = coreSource.indexOf('const runCapabilityDiscoveryTool = async')
    const end = coreSource.indexOf('const runSkillTool', start) > start
      ? coreSource.indexOf('const runSkillTool', start)
      : coreSource.indexOf('const emitStatus', start)
    const discoveryBody = coreSource.slice(start, end > start ? end : start + 7000)
    expect(discoveryBody).not.toContain('totalToolCalls += 1')
  })

  it('does not spend a research round when the model is only navigating disclosure layers', () => {
    expect(coreSource).toContain('let disclosureControlRounds = 0')
    expect(coreSource).toContain('const disclosureOnlyRound = functionCalls.length > 0')
    expect(coreSource).toContain('functionCalls.every((call: Record<string, unknown>) => cleanString(call.name, 120) === DISCOVER_MORE_CAPABILITIES_TOOL_NAME)')
    expect(coreSource).toContain('maxControllerRound = Math.min(MAX_TOOL_ROUNDS + MAX_CAPABILITY_DISCLOSURE_CALLS, maxControllerRound + 1)')
    expect(coreSource).toContain('capability_disclosure_control_rounds: 1')
  })

  it('keeps the separation mechanical rather than semantic', () => {
    expect(coreSource).not.toContain('LRT_CONTROL_PLANE')
    expect(coreSource).not.toContain('CHECK_LRTV3_CONTROL')
    expect(coreSource).not.toContain('if (query.includes('LRT'))')
  })
})
