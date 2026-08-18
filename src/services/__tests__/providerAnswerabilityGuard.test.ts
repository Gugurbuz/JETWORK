import { describe, expect, it } from 'vitest'
import {
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

  it('keeps an all-unsafe answer intact so the authoritative grounding guard can fail closed', () => {
    const original = 'ZCL_FAKE_PERMISSION/CHECK_AUTH tüm yetki kontrolünü yönetir.'
    const result = sanitizeNovelCustomIdentifierClaims(original, 'Yetki kontrolü nasıl çalışır?')

    expect(result.text).toBe(original)
    expect(result.removedIdentifiers).toContain('ZCL_FAKE_PERMISSION/CHECK_AUTH')
  })

  it('extracts custom technical identifiers without treating ordinary SAP terms as custom ids', () => {
    expect(extractCustomTechnicalIdentifiers('SAP CRM ve CRM_ORDER; ZCRM2-545, ZCL_TEST/CHECK_AUTH')).toEqual([
      'ZCRM2-545',
      'ZCL_TEST/CHECK_AUTH',
    ])
  })
})
