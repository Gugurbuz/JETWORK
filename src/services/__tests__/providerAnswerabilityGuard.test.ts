import { describe, expect, it } from 'vitest'
import {
  createStreamingProviderAnswerabilityGuard,
  extractCustomTechnicalIdentifiers,
  sanitizeNovelCustomIdentifierClaims,
} from '../../../supabase/functions/_shared/providerAnswerabilityGuard'

describe('provider answerability guard', () => {
  it('removes a novel custom identifier segment but preserves the safe generic answer', () => {
    const result = sanitizeNovelCustomIdentifierClaims(
      'SAP CRM hata mesajları mesaj sınıfları üzerinden yönetilir. ZCRM2 standart hata sınıfıdır. Mesajın gerçek metni ve numarası sistem konfigürasyonuna göre değerlendirilmelidir.',
      'SAP standart CRM hata kodları neler',
    )

    expect(result.text).toContain('SAP CRM hata mesajları')
    expect(result.text).toContain('sistem konfigürasyonuna')
    expect(result.text).not.toContain('ZCRM2')
    expect(result.removedIdentifiers).toEqual(['ZCRM2'])
    expect(result.removedSegments).toBe(1)
  })

  it('preserves an exact identifier supplied by the user', () => {
    const result = sanitizeNovelCustomIdentifierClaims(
      'ZCRM2-545 için doğrulanmış tetikleyici koşul bulunamadı.',
      'ZCRM2-545 hangi koşulda alınır?',
    )

    expect(result.text).toContain('ZCRM2-545')
    expect(result.removedSegments).toBe(0)
  })

  it('keeps a self-consistent ABAP message claim for the authoritative grounding boundary', () => {
    const result = sanitizeNovelCustomIdentifierClaims(
      'ZCRM_COST-111 için doğrulanmış ABAP satırı `MESSAGE e111(zcrm_cost)` şeklindedir. Sonuç kaynak kanıtıyla ayrıca doğrulanmalıdır.',
      '111 nolu hatanın abap kodunu ver',
    )

    expect(result.text).toContain('ZCRM_COST-111')
    expect(result.text).toContain('MESSAGE e111(zcrm_cost)')
    expect(result.removedIdentifiers).toEqual([])
    expect(result.removedSegments).toBe(0)
  })

  it('does not preserve a message code when the ABAP MESSAGE syntax points to a different code', () => {
    const result = sanitizeNovelCustomIdentifierClaims(
      'Genel kaynak bulundu. ZCRM_COST-111 için satır `MESSAGE e112(zcrm_cost)` şeklindedir. Kaynak ayrıca doğrulanmalıdır.',
      '111 nolu hatanın abap kodunu ver',
    )

    expect(result.text).toContain('Genel kaynak bulundu.')
    expect(result.text).toContain('Kaynak ayrıca doğrulanmalıdır.')
    expect(result.text).not.toContain('ZCRM_COST-111')
    expect(result.removedIdentifiers).toContain('ZCRM_COST-111')
  })

  it('keeps an all-unsafe answer intact so the authoritative grounding guard can fail closed', () => {
    const original = 'ZCL_FAKE_PERMISSION/CHECK_AUTH tüm yetki kontrolünü yönetir.'
    const result = sanitizeNovelCustomIdentifierClaims(original, 'Yetki kontrolü nasıl çalışır?')

    expect(result.text).toBe(original)
    expect(result.removedIdentifiers).toContain('ZCL_FAKE_PERMISSION/CHECK_AUTH')
  })

  it('does not restore an all-unsafe draft when verified evidence exists', () => {
    const original = 'ZCL_CRM_ORDER_UTIL/GET_SATILABILIRI_LIMIT doğrulanmış metottur.'
    const result = sanitizeNovelCustomIdentifierClaims(
      original,
      [
        'GET_SATILABILIR_LIMIT implementasyonunu göster',
        'VERIFIED_KNOWLEDGE_EVIDENCE',
        'method:zcl_crm_order_util/get_satilabilir_limit',
      ].join('\n'),
    )

    expect(result.text).not.toBe(original)
    expect(result.text).not.toContain('GET_SATILABILIRI_LIMIT')
    expect(result.removedIdentifiers).toContain('ZCL_CRM_ORDER_UTIL/GET_SATILABILIRI_LIMIT')
    expect(result.removedSegments).toBeGreaterThan(0)
  })

  it('removes literal fenced source lines that are absent from verified evidence', () => {
    const result = sanitizeNovelCustomIdentifierClaims(
      [
        'Doğrulanmış yapısal kayıt bulundu.',
        '```abap',
        'ZCL_CRM_ORDER_UTIL=>GET_SATILABILIR_LIMIT( ... )',
        'IV_HEADER_GUID = <FS_ORDERADM_H>-GUID',
        '```',
        'Tam implementasyon mevcut değil.',
      ].join('\n'),
      [
        'GET_SATILABILIR_LIMIT ABAP kodu ne',
        'VERIFIED_KNOWLEDGE_EVIDENCE',
        '{"canonicalKey":"method:zcl_crm_order_util/get_satilabilir_limit","content":"structural endpoint only"}',
      ].join('\n'),
    )

    expect(result.text).toContain('Doğrulanmış yapısal kayıt bulundu.')
    expect(result.text).toContain('Tam implementasyon mevcut değil.')
    expect(result.text).not.toContain('ZCL_CRM_ORDER_UTIL=>GET_SATILABILIR_LIMIT( ... )')
    expect(result.text).not.toContain('IV_HEADER_GUID')
    expect(result.text).toContain('literal kod satırları gösterilmedi')
    expect(result.removedSegments).toBeGreaterThanOrEqual(2)
  })

  it('keeps a fenced literal source line when it exists in verified evidence', () => {
    const line = 'MESSAGE e111(zcrm_cost).'
    const result = sanitizeNovelCustomIdentifierClaims(
      `Doğrulanmış satır:\n\`\`\`abap\n${line}\n\`\`\``,
      `111 nolu hatanın ABAP kodu\nVERIFIED_KNOWLEDGE_EVIDENCE\n${line}`,
    )

    expect(result.text).toContain(line)
    expect(result.removedSegments).toBe(0)
  })

  it('extracts custom technical identifiers without treating ordinary SAP terms as custom ids', () => {
    expect(extractCustomTechnicalIdentifiers('SAP CRM ve CRM_ORDER; ZCRM2-545, ZCL_TEST/CHECK_AUTH')).toEqual([
      'ZCRM2-545',
      'ZCL_TEST/CHECK_AUTH',
    ])
  })

  it('streams multiple safe completed segments before finish', () => {
    const emitted: string[] = []
    const guard = createStreamingProviderAnswerabilityGuard({
      requestText: 'SAP CRM hata mesajlarını genel olarak açıkla',
      onText: text => emitted.push(text),
    })

    guard.push('SAP CRM hata mesajları mesaj sınıfları üzerinden yönetilir. ')
    expect(emitted.length).toBe(1)
    guard.push('Standart davranış sistem konfigürasyonuna bağlıdır. ')
    expect(emitted.length).toBe(2)
    guard.push('Son kontrol uygulama loglarından yapılabilir.')
    guard.finish()

    expect(emitted.length).toBe(3)
    expect(emitted.join('')).toContain('Son kontrol')
    expect(guard.stats().removedSegments).toBe(0)
  })

  it('never streams a segment that introduces an unsupported custom identifier', () => {
    const emitted: string[] = []
    const guard = createStreamingProviderAnswerabilityGuard({
      requestText: 'SAP CRM hata mesajlarını genel olarak açıkla',
      onText: text => emitted.push(text),
    })

    guard.push('Genel bilgi güvenlidir. ZCRM2-999 özel mesaj sınıfıdır. Sonuç yine genel tutulmalıdır.')
    guard.finish()

    expect(emitted.join('')).toContain('Genel bilgi güvenlidir.')
    expect(emitted.join('')).toContain('Sonuç yine genel tutulmalıdır.')
    expect(emitted.join('')).not.toContain('ZCRM2-999')
    expect(guard.stats().removedIdentifiers).toEqual(['ZCRM2-999'])
  })

  it('does not apply the batch ABAP exception to streaming output', () => {
    const emitted: string[] = []
    const guard = createStreamingProviderAnswerabilityGuard({
      requestText: '111 nolu hatanın abap kodunu ver',
      onText: text => emitted.push(text),
    })

    guard.push('Genel bilgi güvenlidir. ZCRM_COST-111 için `MESSAGE e111(zcrm_cost)` satırı kullanılır. Güvenli kapanış yapılır.')
    guard.finish()

    expect(emitted.join('')).toContain('Genel bilgi güvenlidir.')
    expect(emitted.join('')).toContain('Güvenli kapanış yapılır.')
    expect(emitted.join('')).not.toContain('ZCRM_COST-111')
    expect(guard.stats().removedIdentifiers).toContain('ZCRM_COST-111')
  })

  it('keeps a safety tail so an identifier split across provider chunks cannot leak', () => {
    const emitted: string[] = []
    const guard = createStreamingProviderAnswerabilityGuard({
      requestText: 'Yetki kontrolü nasıl çalışır?',
      onText: text => emitted.push(text),
    })

    guard.push('Genel kontrol yaklaşımı güvenlidir. ZCL_FA')
    guard.push('KE_PERMISSION/CHECK_AUTH özel davranışı yönetir. Güvenli kapanış yapılır.')
    guard.finish()

    const visible = emitted.join('')
    expect(visible).toContain('Genel kontrol yaklaşımı güvenlidir.')
    expect(visible).toContain('Güvenli kapanış yapılır.')
    expect(visible).not.toContain('ZCL_FAKE_PERMISSION')
    expect(guard.stats().removedSegments).toBe(1)
  })

  it('streams an exact custom identifier when the user supplied it', () => {
    const emitted: string[] = []
    const guard = createStreamingProviderAnswerabilityGuard({
      requestText: 'ZCRM2-545 hangi koşulda alınır?',
      onText: text => emitted.push(text),
    })

    guard.push('ZCRM2-545 için doğrulanmış koşul bulunamadı.')
    guard.finish()

    expect(emitted.join('')).toContain('ZCRM2-545')
    expect(guard.stats().removedSegments).toBe(0)
  })
})
