import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGeminiFinalSynthesisItems } from '../../../supabase/functions/_shared/geminiCostGuard.ts'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('Gemini V5 verified-evidence final synthesis', () => {
  it('keeps exact LRT evidence in the bounded final synthesis snapshot', () => {
    const items: Array<Record<string, unknown>> = [
      { role: 'user', content: 'Lrt ne demek' },
      {
        type: 'function_call',
        call_id: 'lrt-1',
        name: 'get_knowledge_object',
        arguments: JSON.stringify({ canonicalKey: 'method:unscoped_class/check_lrtv3' }),
      },
      {
        type: 'function_call_output',
        call_id: 'lrt-1',
        output: JSON.stringify({
          securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE. Factual record fields are verified.',
          tool: 'get_knowledge_object',
          citationReady: true,
          records: [{
            canonicalKey: 'method:unscoped_class/check_lrtv3',
            objectType: 'method',
            name: 'CHECK_LRTV3',
            title: 'UNSCOPED_CLASS->CHECK_LRTV3',
            summary: 'Enerjisa CRM LRT ürün ailesi kontrolü',
            content: 'LRT = Last Resort Tariff / Son Kaynak Tedarik Tarifesi. Ürün ailesi LRT-V3, LRT-V3A, LRT-V3F, LRT-V3ZF ve LRT-V3NF varyantlarını içerir.',
            sourceName: 'CRM_Metot_Arsivi.txt',
          }],
        }),
      },
    ]

    const serialized = JSON.stringify(buildGeminiFinalSynthesisItems(items))
    expect(serialized).toContain('[JETWORK_TOOL_EVIDENCE]')
    expect(serialized).toContain('method:unscoped_class/check_lrtv3')
    expect(serialized).toContain('Last Resort Tariff')
    expect(serialized).toContain('Son Kaynak Tedarik Tarifesi')
    expect(serialized).toContain('LRT-V3')
  })

  it('runs one same-model tools-off final synthesis when canonical knowledge was collected', () => {
    expect(coreSource).toContain("import { buildGeminiFinalSynthesisItems } from '../_shared/geminiCostGuard.ts'")
    expect(coreSource).toContain('let evidenceFinalSynthesisAttempted = false')
    expect(coreSource).toContain('let evidenceFinalSynthesisPending = false')
    expect(coreSource).toContain("sources.some(source => source.sourceType !== 'web' && Boolean(source.canonicalKey || source.sourceId))")
    expect(coreSource).toContain('const finalSynthesisItems = buildGeminiFinalSynthesisItems(runItems)')
    expect(coreSource).toContain('runItems.splice(0, runItems.length, ...finalSynthesisItems)')
    expect(coreSource).toContain('gemini_evidence_final_synthesis: 1')
    expect(coreSource).toContain('!forceEvidenceFinalSynthesis && (tools.length > 0 || providerWebEnabled || geminiNativeWebPlanned)')
    expect(coreSource).toContain('!forceEvidenceFinalSynthesis && (providerWebEnabled || geminiNativeWebPlanned)')
    expect(coreSource).not.toContain('evaluateGroundedTechnicalClaims')
    expect(coreSource).not.toContain('groundingFailureText')
  })
})
