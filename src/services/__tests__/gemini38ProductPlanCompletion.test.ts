import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeGeminiFunctionCalls } from '../../../supabase/functions/_shared/geminiFunctionContract'

const provider = readFileSync(new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url), 'utf8')
const legacy = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url), 'utf8')
const core = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const surface = readFileSync(new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url), 'utf8')
const client = readFileSync(new URL('../assistantRuntimeClient.ts', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../../store/useSettingsStore.ts', import.meta.url), 'utf8')
const cost = readFileSync(new URL('../../../supabase/functions/_shared/geminiCostGuard.ts', import.meta.url), 'utf8')

describe('Gemini 3.8 product plan completion contracts', () => {
  it('keeps web selection with the active controller instead of deterministic intent routing', () => {
    expect(provider).not.toContain("import { runDeterministicGeminiWebResearch")
    expect(provider).not.toContain("plan?.intent === 'research' && providerWebRequested")
    expect(provider).toContain('requestBaseWithEmptyFinalizationRecovery')
    expect(core).toContain('capabilitySession?.surface.providerWebVisible === true')
  })

  it('validates Gemini 3 function call ids and names without fabricating ids', () => {
    expect(normalizeGeminiFunctionCalls([{ functionCall: { id: 'call_1', name: 'search_knowledge_catalog', args: { query: 'x' } } }]))
      .toEqual([{ id: 'call_1', name: 'search_knowledge_catalog', args: { query: 'x' } }])
    expect(() => normalizeGeminiFunctionCalls([{ functionCall: { name: 'x', args: {} } }])).toThrow('GEMINI_FUNCTION_CALL_ID_MISSING')
    expect(legacy).not.toContain('call.id || crypto.randomUUID()')
    expect(legacy).toContain('_geminiContent: index === 0 ? candidateContent')
  })

  it('has explicit Fast/Balanced/Deep policy without semantic keyword classification', () => {
    expect(settings).toContain("export type WorkMode = 'fast' | 'balanced' | 'deep'")
    expect(settings).toContain("assistant_work_mode")
    expect(legacy).toContain("input.workMode === 'fast'")
    expect(legacy).toContain("input.workMode === 'deep'")
    expect(legacy).toContain("thinkingLevel: selectedThinkingLevel")
  })

  it('surfaces public commentary as a typed controller tool and SSE event', () => {
    expect(surface).toContain("REPORT_PROGRESS_TOOL_NAME = 'report_progress'")
    expect(surface).toContain("enum: ['start', 'finding', 'plan_change', 'blocked']")
    expect(core).toContain("sendEvent(controller, encoder, 'commentary'")
    expect(client).toContain("type: 'commentary'")
  })

  it('supports Gemini multimodal inlineData and implicit-cache telemetry', () => {
    expect(client).toContain("encoding?: 'utf8' | 'base64'")
    expect(client).toContain("'application/pdf'")
    expect(core).toContain('inlineData: { mimeType: attachment.mimeType, data: attachment.content }')
    expect(legacy).toContain('contentPartsForGemini')
    expect(legacy).toContain('cachedContentTokenCount')
  })

  it('prices Gemini 3.8 in the shared 2026 cost telemetry', () => {
    expect(cost).toContain("'gemini-3.8-flash': { input: 0.75, output: 3.75 }")
  })
})
