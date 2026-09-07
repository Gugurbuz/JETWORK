import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractGeminiRuntimeObservationInstruction } from '../../../supabase/functions/_shared/agent/controllerRuntimeObservation.ts'

describe('Controller V3 runtime instruction boundary', () => {
  it('keeps evidence/provenance observations but drops legacy domain workflow prose', () => {
    const input = [
      '[JETWORK REASONING ENGINE - OPERATIONAL CONTEXT]',
      'AGENT_CONTROLLER_ACTIVE: advisory.',
      'CAPABILITY_CANDIDATES: {"version":"controller-capability-surface-v3-full"}',
      'Advisory intent: sap_diagnosis; Advisory complexity: medium; Goal: CHECK_ZTKS neden hata veriyor?',
      'Teknik teşhiste en olası sonucu erken söyle; alternatif kök nedeni göz ardı etme.',
      'Doküman talebinde mevcut Enerjisa doküman sözleşmesini aynen koru.',
      '[UNTRUSTED_EVIDENCE]\nE1: VERIFIED_KNOWLEDGE_EVIDENCE CHECK_ZTKS\n[END_UNTRUSTED_EVIDENCE]',
    ].join('\n\n')

    const output = extractGeminiRuntimeObservationInstruction(input)
    expect(output).toContain('CAPABILITY_CANDIDATES:')
    expect(output).toContain('Advisory intent: sap_diagnosis')
    expect(output).toContain('VERIFIED_KNOWLEDGE_EVIDENCE CHECK_ZTKS')
    expect(output).not.toContain('Teknik teşhiste en olası sonucu erken söyle')
    expect(output).not.toContain('Doküman talebinde mevcut Enerjisa')
    expect(output).toContain('Semantic aksiyonu yine controller modeli seçer')
  })

  it('keeps the active provider on the stateful Interactions runtime and not the superseded adapter', () => {
    const provider = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
      'utf8',
    )
    expect(provider).toContain("from './geminiInteractionsRuntimeV3.ts'")
    expect(provider).not.toContain("from './geminiInteractionsAgent.ts'")
  })
})
