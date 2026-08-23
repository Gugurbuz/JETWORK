import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const unifiedResolver = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsUnifiedKnowledge.ts', import.meta.url),
  'utf8',
)
const completionMigration = readFileSync(
  new URL('../../../supabase/migrations/20260823044500_literal_abap_completion_grounding.sql', import.meta.url),
  'utf8',
)

const normalizeLiteral = (value: string) => value.toLowerCase().replace(/\s+/g, '')

describe('unified knowledge resolution architecture', () => {
  it('uses one canonical resolver instead of the historical quality-wrapper chain', () => {
    expect(unifiedResolver).toContain('assistantTools.ts')
    expect(unifiedResolver).not.toContain('assistantToolsCardinalityAffordance')
    expect(unifiedResolver).not.toContain('assistantToolsRespectModelTypes')
    expect(unifiedResolver).not.toContain('assistantToolsEvidenceBoundary')
    expect(unifiedResolver).toContain("basis: 'catalog_unique'")
    expect(unifiedResolver).toContain("relation_type', 'EMITS_MESSAGE'")
    expect(unifiedResolver).toContain('implementationEvidence')
    expect(unifiedResolver).toContain('literalSource')
    expect(unifiedResolver).toContain('answerContract')
  })

  it('does not keep the superseded follow-up patch in the active source tree', () => {
    expect(existsSync(new URL('../../../supabase/functions/_shared/assistantToolsFollowupImplementationResolution.ts', import.meta.url))).toBe(false)
  })

  it('fails closed when source-code output is not literal published evidence', () => {
    expect(completionMigration).toContain('UNVERIFIED_LITERAL_SOURCE_CODE')
    expect(completionMigration).toContain("o.publication_status = 'published'")
    expect(completionMigration).toContain('v.is_current = true')
    expect(completionMigration).toContain('literal_source_requested')
    expect(completionMigration).toContain('regexp_matches')
  })

  it('distinguishes literal source from plausible fabricated ABAP after whitespace normalization', () => {
    const source = `
      IF sy-subrc EQ 0 AND ls_selected_line-zzprepayment_day IS INITIAL.
        IF 1 = 2. MESSAGE e111(zcrm_cost). ENDIF.
        zcl_crm_ninja_tools=>add_message( iv_msg_number = '111' ).
        RETURN.
      ENDIF.
    `
    const real = `IF sy-subrc EQ 0 AND ls_selected_line-zzprepayment_day IS INITIAL.
      IF 1 = 2. MESSAGE e111(zcrm_cost). ENDIF.
      zcl_crm_ninja_tools=>add_message( iv_msg_number = '111' ).
      RETURN.
    ENDIF.`
    const fabricated = `METHOD check_budget_limit.
      CALL METHOD me->get_remaining_budget.
      MESSAGE e156(zcrm_cost) WITH ms_cost_data-budget_id.
    ENDMETHOD.`

    expect(normalizeLiteral(source)).toContain(normalizeLiteral(real))
    expect(normalizeLiteral(source)).not.toContain(normalizeLiteral(fabricated))
  })
})
