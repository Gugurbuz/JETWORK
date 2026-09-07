import { describe, expect, it } from 'vitest'
import { evaluateGroundedTechnicalClaims } from '../../../supabase/functions/_shared/groundingGuard'

const exactMessageEvidence = () => ({
  output: JSON.stringify({
    securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
    citationReady: true,
    records: [{
      canonicalKey: 'message:zcrm2-545',
      objectType: 'message',
      name: 'ZCRM2-545',
      title: 'Mevcut GB türünden dolayı aktarım olanaksızdır.',
      summary: 'Verified exact CRM message record',
      content: 'ZCRM2-545 — Mevcut GB türünden dolayı aktarım olanaksızdır.',
    }],
  }),
  sources: [{
    sourceId: 'crm-message-source',
    canonicalKey: 'message:zcrm2-545',
    objectType: 'message',
    title: 'Mevcut GB türünden dolayı aktarım olanaksızdır.',
    sourceType: 'knowledge',
  }],
  summary: { citationReady: true, resultCount: 1 },
})

describe('Controller V3 claim-level exact technical grounding', () => {
  it('accepts a causal paraphrase that is directly represented in exact evidence', () => {
    const toolResult = exactMessageEvidence()
    const coverage = evaluateGroundedTechnicalClaims({
      text: 'ZCRM2-545 mevcut GB türü nedeniyle aktarım mümkün olmadığında alınır.',
      plan: { enterpriseGroundingRequired: true },
      sources: toolResult.sources,
      toolResults: [toolResult],
      currentUserText: 'ZCRM2-545 hangi koşulda alınır?',
    })

    expect(coverage.ok).toBe(true)
    expect(coverage.unsupportedIdentifiers).toEqual([])
    expect(coverage.unsupportedClaims).toEqual([])
  })

  it('blocks an invented trigger condition even when the message identifier itself is verified', () => {
    const toolResult = exactMessageEvidence()
    const coverage = evaluateGroundedTechnicalClaims({
      text: 'ZCRM2-545 müşterinin güvence tipi farklı olduğunda alınır.',
      plan: { enterpriseGroundingRequired: true },
      sources: toolResult.sources,
      toolResults: [toolResult],
      currentUserText: 'ZCRM2-545 hangi koşulda alınır?',
    })

    expect(coverage.ok).toBe(false)
    expect(coverage.unsupportedIdentifiers).toEqual([])
    expect(coverage.unsupportedClaims).toEqual([
      'ZCRM2-545 müşterinin güvence tipi farklı olduğunda alınır.',
    ])
  })

  it('still permits an explicit evidence-gap answer instead of forcing a fabricated condition', () => {
    const coverage = evaluateGroundedTechnicalClaims({
      text: 'ZCRM2-545 için doğrulanmış bir kaynak bulamadım; hangi koşulda alındığını kesin olarak söyleyemem.',
      plan: { enterpriseGroundingRequired: true },
      sources: [],
      toolResults: [],
      currentUserText: 'ZCRM2-545 hangi koşulda alınır?',
    })

    expect(coverage.ok).toBe(true)
  })
})
