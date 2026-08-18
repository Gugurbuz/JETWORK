import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)
const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
  'utf8',
)

describe('production answerability + cost guard wiring', () => {
  it('deterministically completes the exact catalog lookup after an empty message detail', () => {
    expect(providerSource).toContain('findEmptyMessageDetailNeedingCatalogCheck')
    expect(providerSource).toContain('cost_guard_exact_identifier_catalog_dispatch')
    expect(providerSource).toContain("name: 'search_knowledge_catalog'")
    expect(providerSource).toContain("objectTypes: ['message']")
  })

  it('does not force provider web on every primary-agent request', () => {
    expect(semanticSource).toContain('knowledgeRequired: userProvidedRequirements ? false : route.knowledgeRequired')
    expect(semanticSource).toContain("webMode: userProvidedRequirements ? 'none' : route.webMode")
    expect(semanticSource).not.toContain("webMode: userProvidedRequirements ? 'none' : 'if_internal_insufficient'")
  })

  it('buffers grounded Gemini technical answers so unsupported custom-id segments can be removed before final grounding', () => {
    expect(providerSource).toContain('sanitizeNovelCustomIdentifierClaims')
    expect(providerSource).toContain('shouldBufferForAnswerabilityGuard')
    expect(providerSource).toContain('grounding_preflight_custom_identifier_segments_removed')
  })
})
