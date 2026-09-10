import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const policySource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
)

describe('Controller acronym definition policy V5', () => {
  it('prefers semantic external verification when enterprise evidence does not contain a material literal expansion', () => {
    expect(policySource).toContain('yalnız kullanım alanını veya ürün ailesini tarif etmek görevi tamamlamaz')
    expect(policySource).toContain('model hafızasına veya aynı Jetbase kavramını tekrar tekrar broad aramaya güvenmek yerine')
    expect(policySource).toContain('public web discovery yap')
    expect(policySource).toContain('güncel/resmi/primary adayı URL Context ile incele')
    expect(policySource).toContain('Hangi kaynağın yeterli olduğuna, dış doğrulamanın gerekli olup olmadığına')
  })

  it('does not hard-code the LRT acceptance answer or route', () => {
    expect(policySource).not.toContain('Last Resort Tariff')
    expect(policySource).not.toContain('CHECK_LRTV3')
    expect(policySource).not.toContain("if (term === 'LRT')")
  })
})
