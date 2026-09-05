import { describe, expect, it } from 'vitest'
import { evaluateGroundedTechnicalClaims } from '../../../supabase/functions/_shared/groundingGuard'

const verifiedMessageEvidence = {
  output: JSON.stringify({
    securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
    citationReady: true,
    records: [{
      canonicalKey: 'message:zcrm2-329',
      objectType: 'message',
      title: 'ZCRM2-329 — Kalem &1: &2&3&4',
      content: 'Faturadar kontrolü başarısız olduğunda MESSAGE e329(zcrm2) üretilir.',
    }],
  }),
  sources: [{
    canonicalKey: 'message:zcrm2-329',
    objectType: 'message',
    title: 'ZCRM2-329 — Kalem &1: &2&3&4',
    sourceId: 'verified-source',
    sourceType: 'knowledge',
  }],
  summary: { citationReady: true },
}

describe('message code vs exact message text grounding', () => {
  it('does not treat a code description as exact T100 text when exact text was not requested', () => {
    const coverage = evaluateGroundedTechnicalClaims({
      text: '- ZCRM2-329 — Faturadar kontrolü başarısız olduğunda üretilir.',
      currentUserText: 'CHECK_FATURADAR hangi mesajları üretiyor?',
      plan: { knowledgeRequired: true },
      sources: verifiedMessageEvidence.sources,
      toolResults: [verifiedMessageEvidence],
    })

    expect(coverage.messageTextMismatches).toEqual([])
    expect(coverage.ok).toBe(true)
  })

  it('keeps strict exact-text validation when the user asks for the message text', () => {
    const coverage = evaluateGroundedTechnicalClaims({
      text: '- ZCRM2-329 — Uydurma birebir mesaj metni',
      currentUserText: 'ZCRM2-329 mesaj metni nedir?',
      plan: { knowledgeRequired: true },
      sources: verifiedMessageEvidence.sources,
      toolResults: [verifiedMessageEvidence],
    })

    expect(coverage.messageTextMismatches).toHaveLength(1)
    expect(coverage.ok).toBe(false)
  })
})
