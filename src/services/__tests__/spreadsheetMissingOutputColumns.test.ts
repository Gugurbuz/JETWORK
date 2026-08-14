import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planSpreadsheetJiraSync } from '../../../supabase/functions/_shared/spreadsheetTransform.ts'

// Live regression: Guncel_Durum/BACKLOG has JIRA but no Durum or Enfast Sprint columns.
// Jira sync must create the requested output columns instead of failing before mutation.
const workerSource = readFileSync(
  new URL('../../../supabase/functions/spreadsheet-execute/index.ts', import.meta.url),
  'utf8',
)
const assistantToolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/spreadsheetAssistantTool.ts', import.meta.url),
  'utf8',
)

describe('Spreadsheet missing output column handling', () => {
  it('creates both requested output columns when the target only has the Jira key', () => {
    const target = {
      headerRow: 1,
      headers: ['JIRA', 'STORY'],
      rows: [['EFA-1', 'Birinci'], ['EFA-2', 'İkinci']],
    }
    const jira = {
      headerRow: 1,
      headers: ['JIRA No', 'Status', 'Sprint'],
      rows: [['EFA-1', 'Done', 'EN-Fast Sprint 102'], ['EFA-2', 'In Progress', 'EN-Fast Sprint 103']],
    }

    const plan = planSpreadsheetJiraSync(target, jira, {
      targetKeyColumn: 'JIRA',
      jiraKeyColumn: 'JIRA No',
      jiraStatusColumn: 'Status',
      targetStatusColumn: 'Durum',
      doneStatuses: ['Done', 'Closed'],
      completedValue: 'tamamlandı',
      jiraSprintColumn: 'Sprint',
      targetSprintColumn: 'Enfast Sprint',
      sprintNamePattern: 'EN-Fast',
    })

    expect(plan.targetStatusColumnCreated).toBe(true)
    expect(plan.targetSprintColumnCreated).toBe(true)
    expect(plan.targetStatusColumn).toBe(3)
    expect(plan.targetSprintColumn).toBe(4)
    expect(plan.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, column: 3, value: 'tamamlandı', reason: 'status' }),
      expect.objectContaining({ row: 2, column: 4, value: 'EN-Fast Sprint 102', reason: 'sprint' }),
    ]))
  })

  it('does not require a pre-existing target status column before planning the worker update', () => {
    expect(workerSource).toContain('toTable(targetSheet, [targetKeyColumn])')
    expect(workerSource).toContain('plan.targetStatusColumnCreated')
    expect(workerSource).toContain('createdColumnCount')
  })

  it('surfaces the worker response error instead of only the generic non-2xx wrapper', () => {
    expect(assistantToolSource).toContain("typeof context.json === 'function'")
    expect(assistantToolSource).toContain('workerDetail')
  })
})
