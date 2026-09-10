import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const policySource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
)

describe('Controller acronym definition policy V5', () => {
  it('separates high-confidence standard expansion from verified enterprise usage', () => {
    expect(policySource).toContain('literal açılımı doğrudan yazmıyorsa bunu otomatik olarak')
    expect(policySource).toContain('yüksek güvenli standart sektör/genel açılımını biliyorsan açılımı cevabın başında ver')
    expect(policySource).toContain('standart/sektörel model bilgisi olarak kurumsal evidence’dan ayır')
    expect(policySource).toContain('Güven düşükse uygun ek araştırmayı seç ya da literal açılımın kurumsal kanıtta doğrulanmadığını açıkça söyle')
  })

  it('does not hard-code the LRT acceptance answer or route', () => {
    expect(policySource).not.toContain('Last Resort Tariff')
    expect(policySource).not.toContain('CHECK_LRTV3')
    expect(policySource).not.toContain("if (term === 'LRT')")
  })
})
