import { describe, expect, it } from 'vitest'
import {
  evaluateGroundedTechnicalClaims,
  extractTechnicalIdentifiers,
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

  it('does not extract fake SAP identifiers from uppercase Turkish words', () => {
    expect(extractTechnicalIdentifiers('SÖZLEŞME DURUMU VE MÜŞTERİ İZİNLERİ')).toEqual([])
    expect(extractTechnicalIdentifiers('ZCRM2-545 ve ZCL_ORDER_SAVE/CHECK_ZTKS')).toEqual([
      'ZCRM2-545',
      'ZCL_ORDER_SAVE/CHECK_ZTKS',
    ])
  })

  it('accepts technical requirements supplied directly by the user when enterprise grounding is explicitly off', () => {
    const supplied = [
      'B2B Portal gereksinimi:',
      'ZCRM2-545',
      'Mesaj Metni: Kullanıcının verdiği örnek hata metni.',
    ].join('\n')
    const coverage = evaluateGroundedTechnicalClaims({
      plan: {
        knowledgeRequired: false,
        enterpriseGroundingRequired: false,
        goal: supplied,
        conversationState: { resolvedRequest: supplied },
      },
      sources: [],
      toolResults: [],
      text: [
        'Analizde ZCRM2-545 dikkate alınmalıdır.',
        'Mesaj Metni: Kullanıcının verdiği örnek hata metni.',
      ].join('\n'),
    })
    expect(coverage.ok).toBe(true)
    expect(coverage.unsupportedIdentifiers).toEqual([])
  })

  it('still blocks a new technical identifier invented by the model', () => {
    const coverage = evaluateGroundedTechnicalClaims({
      plan: {
        knowledgeRequired: false,
        enterpriseGroundingRequired: false,
        goal: 'B2B Portal müşteri izinleri gereksinimini analiz et.',
      },
      sources: [],
      toolResults: [],
      text: 'Bu akış ZCL_FAKE_PERMISSION/CHECK_AUTH metoduyla yönetilir.',
    })
    expect(coverage.ok).toBe(false)
    expect(coverage.unsupportedIdentifiers).toEqual(['ZCL_FAKE_PERMISSION/CHECK_AUTH'])
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

  it('accepts a verified message class namespace derived from exact message evidence only', () => {
    const detail = verifiedMessage('ZCRM-114', '&:Kalemlerde farklı Terim-Zaman olamaz.')
    const coverage = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: detail.sources, toolResults: [detail],
      text: 'ZCRM mesaj sınıfındaki ZCRM-114 doğrulandı.',
    })
    expect(coverage.ok).toBe(true)
    expect(coverage.unsupportedIdentifiers).toEqual([])

    const unrelated = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: detail.sources, toolResults: [detail],
      text: 'ZCRM2 mesaj sınıfı da doğrulandı.',
    })
    expect(unrelated.ok).toBe(false)
    expect(unrelated.unsupportedIdentifiers).toEqual(['ZCRM2'])
  })

  it('derives a verified message code from citation-ready ABAP MESSAGE syntax', () => {
    const method = {
      output: JSON.stringify({
        securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
        tool: 'get_abap_source',
        citationReady: true,
        records: [{
          canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
          objectType: 'method',
          content: "IF 1 = 2. MESSAGE e111(zcrm_cost). ENDIF.",
        }],
      }),
      sources: [{
        canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
        objectType: 'method',
        title: 'NINJA_CALCULATE_ONCRM',
        sourceId: 's-method',
      }],
      summary: { citationReady: true, resultCount: 1 },
    }
    const coverage = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: method.sources, toolResults: [method],
      text: 'ZCRM_COST-111 için ABAP satırı: MESSAGE e111(zcrm_cost).',
    })
    expect(coverage.ok).toBe(true)
    expect(coverage.unsupportedIdentifiers).toEqual([])
  })

  it('accepts an exhaustive canonical message-code list carried by verified ABAP signals', () => {
    const codes = [
      '000','001','002','003','007','011','013','014','015','016','017','018','035','039','083',
      '084','085','086','087','088','089','090','091','092','093','094','096','098','104','111','119',
      '120','123','124','125','134','137','138','142','143','154','155','156','163','164',
    ].map(number => `ZCRM_COST-${number}`)
    const method = {
      output: JSON.stringify({
        securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
        tool: 'get_knowledge_object',
        citationReady: true,
        records: [{
          canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
          objectType: 'method',
          verifiedSignals: { abapMessageCodes: codes },
          content: `[VERIFIED_ABAP_MESSAGE_CODES]\n${codes.join(', ')}\n[END_VERIFIED_ABAP_MESSAGE_CODES]`,
        }],
      }),
      sources: [{
        canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
        objectType: 'method',
        title: 'NINJA_CALCULATE_ONCRM',
        sourceId: 's-method-exhaustive',
      }],
      summary: { citationReady: true, resultCount: 1 },
    }
    const coverage = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: method.sources, toolResults: [method],
      text: codes.join(', '),
    })
    expect(coverage.ok).toBe(true)
    expect(coverage.unsupportedIdentifiers).toEqual([])

    const invented = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: method.sources, toolResults: [method],
      text: `${codes.join(', ')}, ZCRM_COST-999`,
    })
    expect(invented.ok).toBe(false)
    expect(invented.unsupportedIdentifiers).toContain('ZCRM_COST-999')
  })

  it('supports uppercase claims backed by lowercase technical identifiers in verified ABAP source', () => {
    const method = {
      output: JSON.stringify({
        securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
        tool: 'get_abap_source',
        citationReady: true,
        records: [{
          canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
          objectType: 'method',
          content: [
            'IF ls_selected_line-zzprepayment_day IS INITIAL.',
            "  IF 1 = 2. MESSAGE e111(zcrm_cost). ENDIF.",
            "  zcl_crm_ninja_tools=>add_message( iv_msg_number = '111' ).",
            'ENDIF.',
            'Bu alan zorunludur.',
          ].join('\n'),
        }],
      }),
      sources: [{
        canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
        objectType: 'method',
        title: 'NINJA_CALCULATE_ONCRM',
        sourceId: 's-method-lowercase',
      }],
      summary: { citationReady: true, resultCount: 1 },
    }

    const supported = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: method.sources, toolResults: [method],
      text: 'ZZPREPAYMENT_DAY kontrol edilir ve ZCL_CRM_NINJA_TOOLS/ADD_MESSAGE çağrılır.',
    })
    expect(supported.ok).toBe(true)
    expect(supported.unsupportedIdentifiers).toEqual([])

    const proseWord = evaluateGroundedTechnicalClaims({
      plan: { knowledgeRequired: true }, sources: method.sources, toolResults: [method],
      text: 'ZORUNLUDUR teknik bir identifier olarak doğrulandı.',
    })
    expect(proseWord.ok).toBe(false)
    expect(proseWord.unsupportedIdentifiers).toEqual(['ZORUNLUDUR'])
  })
})
