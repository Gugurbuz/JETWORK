import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateGroundedTechnicalClaims,
  shouldFailClosedGroundedAnswer,
} from '../../../supabase/functions/_shared/groundingGuard'
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine'

const plan: ReasoningPlan = {
  intent: 'analysis',
  complexity: 'medium',
  goal: 'Kullanıcının istediği bilgiyi doğrula',
  knowledgeRequired: true,
  enterpriseGroundingRequired: false,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  executionMode: 'knowledge',
}

describe('dynamic evidence-gap finalization', () => {
  it('allows an exact identifier to be repeated only as a verified-evidence gap', () => {
    const coverage = evaluateGroundedTechnicalClaims({
      text: 'ZCRM2-545 için doğrulanmış bir kayıt bulamadım. Bu nedenle hangi koşulda oluştuğunu kesin olarak söyleyemem.',
      plan,
      sources: [],
      toolResults: [],
    })

    expect(coverage.ok).toBe(true)
    expect(coverage.verifiedKnowledgeEvidence).toBe(false)
    expect(coverage.unsupportedIdentifiers).toEqual([])
    expect(shouldFailClosedGroundedAnswer({ plan, coverage })).toBe(false)
  })

  it('still blocks an unsupported exact claim even when no evidence exists', () => {
    const coverage = evaluateGroundedTechnicalClaims({
      text: 'ZCRM2-545 sözleşme başlangıç tarihi farklı olduğunda alınır.',
      plan,
      sources: [],
      toolResults: [],
    })

    expect(coverage.ok).toBe(false)
    expect(coverage.unsupportedIdentifiers).toContain('ZCRM2-545')
    expect(shouldFailClosedGroundedAnswer({ plan, coverage })).toBe(true)
  })

  it('does not allow a gap disclaimer to launder a fabricated claim in the same response', () => {
    const coverage = evaluateGroundedTechnicalClaims({
      text: 'ZCRM2-545 için doğrulanmış bir kayıt bulamadım, ancak bu mesaj sözleşme başlangıç tarihi farklı olduğunda alınır.',
      plan,
      sources: [],
      toolResults: [],
    })

    expect(coverage.ok).toBe(false)
    expect(coverage.unsupportedIdentifiers).toContain('ZCRM2-545')
  })

  it('lets the controller describe and investigate evidence gaps dynamically', () => {
    const policySource = readFileSync(
      new URL('../../../supabase/functions/_shared/agentControllerPolicy.ts', import.meta.url),
      'utf8',
    )

    expect(policySource).toContain('Exact teknik identifier içeren kurumsal iddialarda exact-technical-evidence kuralını koru')
    expect(policySource).toContain('Bir arama boş döndüğünde bunu otomatik bitiş sinyali sayma')
    expect(policySource).toContain('Tool sonucu yalnız bir observationdır')
    expect(policySource).toContain('belirsizlikler ve gerekiyorsa sonraki aksiyonu ver')
  })
})