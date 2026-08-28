import { describe, expect, it } from 'vitest'
import { evaluateGroundedTechnicalClaims } from '../../../supabase/functions/_shared/groundingGuard.ts'
import { extractExactTechnicalIdentifiers } from '../../../supabase/functions/_shared/technicalIdentifier.ts'

describe('long supplied requirement grounding regression', () => {
  it('uses the actual current user text rather than a truncated semantic-plan copy', () => {
    const prefix = 'Talep dokümanı ve iş kuralları. '.repeat(500)
    const currentUserText = `${prefix} Rapor ZCRM_COST_REPORT tablosu ZTAB0000RY ve ZCRM_NINJA_LOG_I / ZCRM_NINJA_LOG_O üzerinden üretilecektir.`
    const result = evaluateGroundedTechnicalClaims({
      text: 'Analizde ZCRM_COST_REPORT, ZTAB0000RY, ZCRM_NINJA_LOG_I ve ZCRM_NINJA_LOG_O etkilenmektedir.',
      plan: { knowledgeRequired: false, enterpriseGroundingRequired: false, goal: currentUserText.slice(0, 1200) },
      sources: [],
      toolResults: [],
      currentUserText,
    })
    expect(result.ok).toBe(true)
    expect(result.unsupportedIdentifiers).toEqual([])
  })

  it('does not treat Turkish prose fragments as exact technical identifiers', () => {
    expect(extractExactTechnicalIdentifiers('tüketim üzerinden aynı zamanda düzenlenmesi zamanında yapılır')).toEqual([])
    expect(extractExactTechnicalIdentifiers('ZCRM_COST_REPORT ZTAB0000RY CHECK_FATURADAR')).toEqual(['ZCRM_COST_REPORT','ZTAB0000RY','CHECK_FATURADAR'])
  })
})
