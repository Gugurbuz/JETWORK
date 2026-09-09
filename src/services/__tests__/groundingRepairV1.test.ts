import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('bounded grounding repair v1', () => {
  it('returns failed grounding to the same Controller once before fail-closed', () => {
    expect(coreSource).toContain('let groundingRepairAttempted = false')
    expect(coreSource).toContain('let maxControllerRound = MAX_TOOL_ROUNDS')
    expect(coreSource).toContain('[GROUNDING_REPAIR_OBSERVATION]')
    expect(coreSource).toContain('grounding_repair_requested')
    expect(coreSource).toContain('maxControllerRound = Math.min(MAX_TOOL_ROUNDS + 2')
    expect(coreSource).toContain('roundText = groundingFailureText()')
    expect(coreSource).toContain("const canLiveStreamProviderText = activeProvider === 'gemini'")
    expect(coreSource).toContain('&& totalToolCalls === 0')
  })

  it('does not hard-code a semantic recovery tool or query', () => {
    const start = coreSource.indexOf('const mayRequestGroundingRepair')
    const end = coreSource.indexOf("console.warn('ASSISTANT_GROUNDING_COVERAGE_BLOCKED'", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const repairBlock = coreSource.slice(start, end)
    expect(repairBlock).not.toContain("runKnowledgeTool('")
    expect(repairBlock).not.toContain("toolName: 'get_")
    expect(repairBlock).not.toContain('search_knowledge_catalog')
    expect(repairBlock).toContain('Sıradaki capability/tool çağrısı, sorgu, ek araştırma veya final cevap kararı yalnız Controller LLM olarak sana aittir.')
  })

  it('allows only one repair attempt and preserves the terminal safety fallback', () => {
    expect(coreSource.match(/groundingRepairAttempted = true/g)?.length).toBe(1)
    expect(coreSource).toContain('&& !groundingRepairAttempted')
    expect(coreSource).toContain('grounding_fail_closed: 1')
    expect(coreSource).toContain('grounding_unverified_provider_text_discarded: 1')
  })
})
