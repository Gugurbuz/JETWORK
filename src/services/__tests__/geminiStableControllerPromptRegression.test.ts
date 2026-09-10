import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateGroundedTechnicalClaims } from '../../../supabase/functions/_shared/groundingGuard'

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)

describe('Gemini Controller stable prompt regression', () => {
  it('compacts the versioned product prompt before composing the Controller system instruction', () => {
    expect(providerSource).toContain("const rawStableProductInstruction = String(input.stableInstructions || '').trim()")
    expect(providerSource).toContain('buildProviderProductCore(rawStableProductInstruction)')
    expect(providerSource).toContain('stableProductInstruction,')
    expect(providerSource).toContain('AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION,')
    expect(providerSource).toContain('runtimeObservation,')
    expect(providerSource).not.toContain('semantic planner')
  })

  it('rejects a generic evidence gap when the requested numeric message was already verified', () => {
    const evidence = {
      output: JSON.stringify({
        records: [{
          canonicalKey: 'message:zcrm_cost-111',
          objectType: 'message',
          title: 'ZCRM_COST-111 — Ön ödeme günü zorunludur.',
        }],
      }),
      sources: [{
        sourceType: 'knowledge',
        canonicalKey: 'message:zcrm_cost-111',
        objectType: 'message',
        title: 'ZCRM_COST-111 — Ön ödeme günü zorunludur.',
      }],
      summary: { citationReady: true },
    }

    const coverage = evaluateGroundedTechnicalClaims({
      text: '111 numaralı hata için yeterli güvenilir kaynak bulunamadı; mesaj sınıfı belirtilmedi.',
      plan: { knowledgeRequired: true, enterpriseGroundingRequired: true },
      sources: evidence.sources,
      toolResults: [evidence],
      currentUserText: '111 nolu hatanın abap kodunu ver',
    })

    expect(coverage.ok).toBe(false)
    expect(coverage.unsupportedClaims).toContain('verified_message_number:111:response_reported_gap')
  })
})
