import { describe, expect, it } from 'vitest'
import {
  evaluateGroundedTechnicalClaims,
  resultHasVerifiedKnowledgeEvidence,
  shouldFailClosedGroundedAnswer,
} from '../../../supabase/functions/_shared/groundingGuard'

const verifiedMessage = (code: string, title: string) => ({
  output: JSON.stringify({
    securityNotice: 'UNTRUSTED_KNOWLEDGE_DATA',
    tool: 'get_message_detail',
    records: [{ canonicalKey: `message:${code.toLowerCase()}`, objectType: 'message', title }],
  }),
  sources: [{ canonicalKey: `message:${code.toLowerCase()}`, objectType: 'message', title, sourceId: 's1' }],
  summary: { citationReady: true, resultCount: 1 },
})

describe('grounding claim coverage P0', () => {
  it('does not count candidate-only semantic search as verified evidence', () => {
    expect(resultHasVerifiedKnowledgeEvidence({
      output: '{}', sources: [], summary: { citationReady: false, resultCount: 6 },
    })).toBe(false)
  })

  it('blocks the reproduced one-source-enables-many-claims incident', () => {
    const only = verifiedMessage('ZB2B_CIKTI-000', '&1&2&3&4')
    const text = [
      'ZB2B_CIKTI-000',
      'Mesaj Metni: &1&2&3&4',
      'ZB2B_CIKTI-002',
      'Mesaj Metni: Seçilen çıktı tipi için onay akışı başlatılamadı.',
      'ZCRM_PRICE_KEY-042',
      'Mesaj Metni: Girilen tarih aralığı mevcut bir kayıtla çakışmaktadır.',
      'ZCRM_PRICE_KEY-045',
      'Mesaj Metni: Belirtilen koşul türü için fiyatlandırma anahtarı üretilemedi.',
    ].join('\n')
    const coverage = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: only.sources, toolResults: [only], text,
    })
    expect(coverage.ok).toBe(false)
    expect(coverage.unsupportedIdentifiers.sort()).toEqual([
      'ZB2B_CIKTI-002', 'ZCRM_PRICE_KEY-042', 'ZCRM_PRICE_KEY-045',
    ])
    expect(shouldFailClosedGroundedAnswer({ plan: { knowledgeRequired: true }, coverage })).toBe(true)
  })

  it('blocks a fabricated exact message text even when the code itself is verified', () => {
    const detail = verifiedMessage('ZCRM_PRICE_KEY-042', 'Kalem &1: Satış kanalı kuralı sağlanamadı (&2).')
    const coverage = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: detail.sources, toolResults: [detail],
      text: 'ZCRM_PRICE_KEY-042\nMesaj Metni: Girilen tarih aralığı mevcut bir kayıtla çakışmaktadır.',
    })
    expect(coverage.unsupportedIdentifiers).toEqual([])
    expect(coverage.messageTextMismatches).toHaveLength(1)
    expect(coverage.ok).toBe(false)
  })

  it('accepts exact message text copied from citation-ready authoritative evidence', () => {
    const detail = verifiedMessage('ZCRM_PRICE_KEY-045', 'Kalem &1: İzin verilen sözleşme adedi sınırı aşılmıştır.')
    const coverage = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: detail.sources, toolResults: [detail],
      text: 'ZCRM_PRICE_KEY-045\nMesaj Metni: Kalem &1: İzin verilen sözleşme adedi sınırı aşılmıştır.',
    })
    expect(coverage.ok).toBe(true)
  })
})
