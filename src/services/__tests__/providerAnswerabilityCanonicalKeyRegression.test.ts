import { describe, expect, it } from 'vitest'
import { sanitizeNovelCustomIdentifierClaims } from '../../../supabase/functions/_shared/providerAnswerabilityGuard'

describe('provider answerability canonical-key regression', () => {
  it('normalizes uppercase canonical provenance keys in a verified structural answer', () => {
    const result = sanitizeNovelCustomIdentifierClaims(
      [
        'Tam ABAP implementasyon kodu mevcut değildir.',
        'Canonical: METHOD:ZCL_SATILABILIR_LIMIT/GET_SATILABILIR_LIMIT',
        'Alternatif: METHOD:ZCL_CRM_ORDER_UTIL/GET_SATILABILIR_LIMIT',
        'Display çağrı: ZCL_CRM_ORDER_UTIL=>GET_SATILABILIR_LIMIT',
      ].join('\n'),
      [
        'GET_SATILABILIR_LIMIT implementasyonunu göster',
        'VERIFIED_KNOWLEDGE_EVIDENCE',
        'method:zcl_satilabilir_limit/get_satilabilir_limit',
        'method:zcl_crm_order_util/get_satilabilir_limit',
      ].join('\n'),
    )

    expect(result.text).toContain('Tam ABAP implementasyon kodu mevcut değildir.')
    expect(result.text).toContain('method:zcl_satilabilir_limit/get_satilabilir_limit')
    expect(result.text).toContain('method:zcl_crm_order_util/get_satilabilir_limit')
    expect(result.text).not.toContain('METHOD:ZCL_SATILABILIR_LIMIT')
    expect(result.text).not.toContain('ZCL_CRM_ORDER_UTIL=>GET_SATILABILIR_LIMIT')
  })
})
