import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const providerBaseSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
)
const interactionsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiInteractionsRuntimeV3.ts', import.meta.url),
  'utf8',
)
const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
  'utf8',
)

describe('production answerability + cost guard wiring', () => {
  it('keeps exact-identifier safety without deterministic catalog routing', () => {
    expect(providerBaseSource).toContain('sanitizeNovelCustomIdentifierClaims')
    expect(providerBaseSource).not.toContain('findEmptyMessageDetailNeedingCatalogCheck')
    expect(providerBaseSource).not.toContain('cost_guard_exact_identifier_catalog_dispatch')
    expect(coreSource).toContain('evaluateGroundedTechnicalClaims')
    expect(coreSource).toContain('shouldFailClosedGroundedAnswer')
    expect(coreSource).toContain('groundingFailureText()')
    expect(interactionsSource).not.toContain("name: 'search_knowledge_catalog'")
  })

  it('requires internal evidence for structured BA requirements without forcing provider web', () => {
    expect(semanticSource).toContain('knowledgeRequired: userProvidedRequirements ? true : route.knowledgeRequired')
    expect(semanticSource).toContain('enterpriseGroundingRequired: userProvidedRequirements')
    expect(semanticSource).toContain("webMode: userProvidedRequirements ? 'none' : route.webMode")
    expect(semanticSource).not.toContain("webMode: userProvidedRequirements ? 'none' : 'if_internal_insufficient'")
  })

  it('streams Gemini Interactions deltas while keeping final exact-claim answerability at the core boundary', () => {
    expect(interactionsSource).toContain('stream: true')
    expect(interactionsSource).toContain("eventType === 'step.delta'")
    expect(interactionsSource).toContain('input.onText(delta.text)')
    expect(interactionsSource).toContain('normalizeUsageWithTiming')
    expect(coreSource).toContain('const canLiveStreamProviderText = activeProvider === \'gemini\'')
    expect(coreSource).toContain('hasExactCustomIdentifierInRequest')
    expect(coreSource).toContain("sendEvent(controller, encoder, 'text_delta'")
    expect(coreSource).toContain('shouldFailClosedGroundedAnswer')
  })
})