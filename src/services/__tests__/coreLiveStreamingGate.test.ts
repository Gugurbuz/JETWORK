import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('core live streaming gate', () => {
  it('streams safe Gemini turns without requiring native web mode', () => {
    const gateStart = coreSource.indexOf('const hasExactCustomIdentifierInRequest')
    const gateEnd = coreSource.indexOf("if (activeProvider === 'gemini')", gateStart)
    const gate = coreSource.slice(gateStart, gateEnd)
    expect(gate).toContain("const canLiveStreamProviderText = activeProvider === 'gemini'")
    expect(gate).not.toContain('&& geminiNativeWebPlanned')
  })

  it('keeps exact enterprise identifiers and semantic artifact turns buffered', () => {
    expect(coreSource).toContain('hasExactCustomIdentifierInRequest')
    expect(coreSource).toContain("plan.enterpriseGroundingRequired !== true")
    expect(coreSource).toContain("plan.intent !== 'sap_diagnosis'")
    expect(coreSource).toContain('!hasExactCustomIdentifierInRequest')
    expect(coreSource).toContain("plan.executionMode !== 'artifact'")
    expect(coreSource).not.toContain('artifactMutationRequested')
  })

  it('still emits each approved provider delta directly to SSE', () => {
    expect(coreSource).toContain("sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta })")
    expect(coreSource).toContain('roundTextStreamed = true')
  })
})
