import { describe, expect, it } from 'vitest'
import {
  canonicalizeProviderCanonicalKeyLiterals,
  replaceProviderResponseVisibleText,
} from '../../../supabase/functions/_shared/providerResponseText'

describe('provider response canonical key serialization', () => {
  it('normalizes canonical knowledge-key literals to lowercase without rewriting display identifiers', () => {
    const text = [
      'Canonical: METHOD:ZCL_SATILABILIR_LIMIT/GET_SATILABILIR_LIMIT',
      'Display: ZCL_SATILABILIR_LIMIT=>GET_SATILABILIR_LIMIT',
    ].join('\n')

    const normalized = canonicalizeProviderCanonicalKeyLiterals(text)
    expect(normalized).toContain('method:zcl_satilabilir_limit/get_satilabilir_limit')
    expect(normalized).toContain('ZCL_SATILABILIR_LIMIT=>GET_SATILABILIR_LIMIT')
  })

  it('writes the normalized canonical text back into provider output', () => {
    const response = {
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'old' }],
      }],
    }

    const updated = replaceProviderResponseVisibleText(
      response,
      'Tam implementasyon mevcut değil. Canonical key: METHOD:ZCL_CRM_ORDER_UTIL/GET_SATILABILIR_LIMIT',
    )
    const text = String((updated.output?.[0]?.content as Array<Record<string, unknown>>)?.[0]?.text || '')

    expect(text).toContain('tam implementasyon mevcut değil')
    expect(text).toContain('method:zcl_crm_order_util/get_satilabilir_limit')
    expect(text).not.toContain('METHOD:ZCL_CRM_ORDER_UTIL')
  })
})
