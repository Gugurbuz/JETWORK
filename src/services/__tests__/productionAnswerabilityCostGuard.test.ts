import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const providerBaseSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
)
const providerWrapperSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)
const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
  'utf8',
)

describe('production answerability + cost guard wiring', () => {
  it('deterministically completes the exact catalog lookup after an empty message detail', () => {
    expect(providerBaseSource).toContain('findEmptyMessageDetailNeedingCatalogCheck')
    expect(providerBaseSource).toContain('cost_guard_exact_identifier_catalog_dispatch')
    expect(providerBaseSource).toContain("name: 'search_knowledge_catalog'")
    expect(providerBaseSource).toContain("objectTypes: ['message']")
  })

  it('does not force provider web on every primary-agent request', () => {
    expect(semanticSource).toContain('knowledgeRequired: userProvidedRequirements ? false : route.knowledgeRequired')
    expect(semanticSource).toContain("webMode: userProvidedRequirements ? 'none' : route.webMode")
    expect(semanticSource).not.toContain("webMode: userProvidedRequirements ? 'none' : 'if_internal_insufficient'")
  })

  it('keeps custom-id answerability protection while emitting safe Gemini segments incrementally', () => {
    expect(providerBaseSource).toContain('sanitizeNovelCustomIdentifierClaims')
    expect(providerBaseSource).toContain('shouldBufferForAnswerabilityGuard')
    expect(providerWrapperSource).toContain('createStreamingProviderAnswerabilityGuard')
    expect(providerWrapperSource).toContain('requestBaseWithStreamingAnswerability')
    expect(providerWrapperSource).toContain('onText: delta => guard.push(delta)')
    expect(providerWrapperSource).toContain('answerability_streaming_guard_used')
  })
})
