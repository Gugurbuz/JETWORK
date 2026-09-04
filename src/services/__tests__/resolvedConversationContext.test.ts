import { describe, expect, it } from 'vitest'
import {
  buildResolvedConversationInstruction,
  compactResolvedConversationItems,
} from '../../../supabase/functions/_shared/resolvedConversationContext'

const contentOf = (item: Record<string, unknown>) => String(item.content || '')

describe('resolved conversation context', () => {
  it('keeps an older relevant user constraint while dropping stale unrelated history', () => {
    const items: Array<Record<string, unknown>> = [
      { role: 'user', content: 'ZCRM2-338 analizinde web kullanma; yalnız doğrulanmış kurum içi kaynaklarla ilerle.' },
      { role: 'assistant', content: 'Anlaşıldı, ZCRM2-338 için kurum içi kanıt sınırını koruyacağım.' },
    ]
    for (let index = 0; index < 12; index += 1) {
      items.push({ role: 'user', content: `unrelated-${index} bambaşka bir konu hakkında kısa soru` })
      items.push({ role: 'assistant', content: `unrelated-${index} için geçici cevap` })
    }
    items.push({ role: 'user', content: 'Şimdi ZCRM2-338 için tam analizi ver.' })

    const compacted = compactResolvedConversationItems(items, {
      resolvedRequest: 'ZCRM2-338 için doğrulanmış kurum içi kanıtlarla tam analiz ver',
      topic: 'ZCRM2-338',
      activeEntities: ['ZCRM2-338'],
    })
    const serialized = JSON.stringify(compacted)

    expect(compacted.length).toBeLessThan(items.length)
    expect(serialized).toContain('web kullanma')
    expect(serialized).toContain('Şimdi ZCRM2-338 için tam analizi ver.')
    expect(serialized).not.toContain('unrelated-0')
  })

  it('does not promote old assistant prose into durable context only because it shares keywords', () => {
    const items: Array<Record<string, unknown>> = [
      { role: 'assistant', content: 'ZCRM2-338 hakkında eski ve artık güvenilmemesi gereken bir model varsayımı.' },
      { role: 'user', content: 'eski alakasız kullanıcı konusu' },
      { role: 'assistant', content: 'eski alakasız cevap' },
    ]
    for (let index = 0; index < 6; index += 1) {
      items.push({ role: 'user', content: `yakın konu ${index}` })
      items.push({ role: 'assistant', content: `yakın cevap ${index}` })
    }
    items.push({ role: 'user', content: 'ZCRM2-338 için devam et.' })

    const compacted = compactResolvedConversationItems(items, {
      resolvedRequest: 'ZCRM2-338 için devam et',
      activeEntities: ['ZCRM2-338'],
    }, { recentConversationItems: 4 })

    expect(JSON.stringify(compacted)).not.toContain('eski ve artık güvenilmemesi gereken bir model varsayımı')
  })

  it('preserves the active tool protocol after the current user message', () => {
    const items: Array<Record<string, unknown>> = [
      { role: 'user', content: 'önceki soru' },
      { role: 'assistant', content: 'önceki cevap' },
      { role: 'user', content: 'CHECK_ZTKS mesajlarını bul.' },
      { type: 'function_call', name: 'search_knowledge_catalog', call_id: 'call-1', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-1', output: '[{"canonicalKey":"CHECK_ZTKS"}]' },
    ]

    const compacted = compactResolvedConversationItems(items, {
      resolvedRequest: 'CHECK_ZTKS mesajlarını bul',
      activeEntities: ['CHECK_ZTKS'],
    })

    expect(compacted.at(-2)).toEqual(items.at(-2))
    expect(compacted.at(-1)).toEqual(items.at(-1))
  })

  it('bounds historical context without truncating the active user turn', () => {
    const items: Array<Record<string, unknown>> = []
    for (let index = 0; index < 30; index += 1) {
      items.push({ role: 'user', content: `history-${index} ${'x'.repeat(700)}` })
      items.push({ role: 'assistant', content: `answer-${index} ${'y'.repeat(700)}` })
    }
    const active = `aktif-talep ${'z'.repeat(9_000)}`
    items.push({ role: 'user', content: active })

    const compacted = compactResolvedConversationItems(items, {
      resolvedRequest: 'aktif-talep',
    }, {
      maxHistoricalCharacters: 4_000,
      recentConversationItems: 4,
      relevantOlderUserItems: 0,
    })

    expect(compacted.length).toBeLessThan(10)
    expect(contentOf(compacted.at(-1) as Record<string, unknown>)).toBe(active)
  })

  it('marks resolved state as continuity context rather than enterprise evidence', () => {
    const instruction = buildResolvedConversationInstruction({
      resolvedRequest: 'Kalan kalite geliştirmelerini tamamla',
      topic: 'conversation quality',
      activeEntities: ['Project Brain'],
      userDecisions: ['Raw history modele yığılmayacak'],
      rejectedScopes: ['Qwen'],
      openQuestions: ['CI tamamen yeşil mi?'],
      verifiedFactRefs: ['source:123'],
    })

    expect(instruction).toContain('NOT EVIDENCE')
    expect(instruction).toContain('Raw history modele yığılmayacak')
    expect(instruction).toContain('Qwen')
    expect(instruction).toContain('gerçek knowledge/web kanıtı')
  })
})
