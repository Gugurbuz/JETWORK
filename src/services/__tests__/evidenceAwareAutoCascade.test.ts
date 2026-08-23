import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const router = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-router-v3/index.ts', import.meta.url),
  'utf8',
)
const tools = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsEvidenceAware.ts', import.meta.url),
  'utf8',
)

describe('evidence-aware auto cascade', () => {
  it('does not hard-lock exact identifiers to Lite', () => {
    expect(router).not.toContain('exact_identifier_lite_guard')
    expect(router).not.toContain('allowFlash: false')
    expect(router).not.toContain('allowPro: false')
    expect(router).toContain('exact_identifier_lite_start_not_lock')
  })

  it('uses structured evidence states rather than answer-text failure phrases', () => {
    expect(router).toContain("evidence.state === 'unresolved'")
    expect(router).toContain("evidence.state === 'conflict'")
    expect(router).toContain("evidence.state === 'complete'")
    expect(router).toContain('enterprise_evidence_found_unresolved')
    expect(router).not.toMatch(/bulamadım|bulamadi|ulaşamadım|ulasamadim|kanıt.*yok.*cevap/iu)
  })

  it('keeps no-evidence requests at their existing capacity instead of escalating blindly', () => {
    expect(router).toContain('enterprise_no_evidence_keep_capacity')
  })

  it('exposes the generic technical-reference evidence tool to Auto core', () => {
    expect(tools).toContain("./assistantToolsTechnicalReferenceQuality.ts")
    const technical = readFileSync(
      new URL('../../../supabase/functions/_shared/assistantToolsTechnicalReferenceQuality.ts', import.meta.url),
      'utf8',
    )
    expect(technical).toContain("name: 'get_objects_by_technical_reference'")
    expect(technical).toContain('deterministicTechnicalReferenceLookup: true')
  })
})
