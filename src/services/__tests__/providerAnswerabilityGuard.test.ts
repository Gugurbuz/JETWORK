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
