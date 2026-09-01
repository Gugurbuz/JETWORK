import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('agentic enumeration provider parity', () => {
  it('keeps deterministic enumeration only as a legacy rollback path', () => {
    expect(coreSource).toContain('const deterministicEnumeration = AGENTIC_CONTROLLER_ENABLED')
    expect(coreSource).toContain('? null')
    expect(coreSource).toContain(': buildDeterministicEnumerationFinalization(runItems')

    const guardIndex = coreSource.indexOf('const deterministicEnumeration = AGENTIC_CONTROLLER_ENABLED')
    const geminiBranchIndex = coreSource.indexOf("if (activeProvider === 'gemini')")
    const openAiRequestIndex = coreSource.indexOf('return await requestOpenAiResponse')
    expect(guardIndex).toBeGreaterThan(0)
    expect(geminiBranchIndex).toBeGreaterThan(guardIndex)
    expect(openAiRequestIndex).toBeGreaterThan(guardIndex)
  })
})