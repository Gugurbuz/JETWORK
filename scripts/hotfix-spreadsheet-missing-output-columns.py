from pathlib import Path

transform_path = Path('supabase/functions/_shared/spreadsheetTransform.ts')
worker_path = Path('supabase/functions/spreadsheet-execute/index.ts')
assistant_tool_path = Path('supabase/functions/_shared/spreadsheetAssistantTool.ts')
test_path = Path('src/services/__tests__/spreadsheetMissingOutputColumns.test.ts')
workflow_path = Path('.github/workflows/hotfix-spreadsheet-missing-output-columns.yml')
script_path = Path('scripts/hotfix-spreadsheet-missing-output-columns.py')

transform = transform_path.read_text()
worker = worker_path.read_text()
assistant_tool = assistant_tool_path.read_text()

transform_replacements = [
    (
        "  targetStatusColumn: number\n  targetSprintColumn: number\n  targetSprintColumnCreated: boolean",
        "  targetStatusColumn: number\n  targetStatusColumnCreated: boolean\n  targetSprintColumn: number\n  targetSprintColumnCreated: boolean",
    ),
    (
        "  const jiraStatusIndex = requireColumn(jira.headers, config.jiraStatusColumn, 'jira')\n  const targetStatusIndex = requireColumn(target.headers, config.targetStatusColumn, 'target')\n  const jiraSprintIndex = requireColumn(jira.headers, config.jiraSprintColumn, 'jira')\n  const existingTargetSprintIndex = columnIndex(target.headers, config.targetSprintColumn)\n  const targetSprintIndex = existingTargetSprintIndex >= 0 ? existingTargetSprintIndex : target.headers.length",
        "  const jiraStatusIndex = requireColumn(jira.headers, config.jiraStatusColumn, 'jira')\n  const jiraSprintIndex = requireColumn(jira.headers, config.jiraSprintColumn, 'jira')\n  const existingTargetStatusIndex = columnIndex(target.headers, config.targetStatusColumn)\n  const existingTargetSprintIndex = columnIndex(target.headers, config.targetSprintColumn)\n  let nextTargetColumnIndex = target.headers.length\n  const targetStatusIndex = existingTargetStatusIndex >= 0 ? existingTargetStatusIndex : nextTargetColumnIndex++\n  const targetSprintIndex = existingTargetSprintIndex >= 0 ? existingTargetSprintIndex : nextTargetColumnIndex++",
    ),
    (
        "  if (duplicateJiraKeys > 0) warnings.push(`${duplicateJiraKeys} ek Jira kaydı aynı issue key altında birleştirildi.`)\n  if (existingTargetSprintIndex < 0) warnings.push(`\"${config.targetSprintColumn}\" kolonu hedef dosyaya eklenecek.`)",
        "  if (duplicateJiraKeys > 0) warnings.push(`${duplicateJiraKeys} ek Jira kaydı aynı issue key altında birleştirildi.`)\n  if (existingTargetStatusIndex < 0) warnings.push(`\"${config.targetStatusColumn}\" kolonu hedef dosyaya eklenecek.`)\n  if (existingTargetSprintIndex < 0) warnings.push(`\"${config.targetSprintColumn}\" kolonu hedef dosyaya eklenecek.`)",
    ),
    (
        "    targetStatusColumn: targetStatusIndex + 1,\n    targetSprintColumn: targetSprintIndex + 1,\n    targetSprintColumnCreated: existingTargetSprintIndex < 0,",
        "    targetStatusColumn: targetStatusIndex + 1,\n    targetStatusColumnCreated: existingTargetStatusIndex < 0,\n    targetSprintColumn: targetSprintIndex + 1,\n    targetSprintColumnCreated: existingTargetSprintIndex < 0,",
    ),
]

for old, new in transform_replacements:
    count = transform.count(old)
    if count != 1:
        raise SystemExit(f'Transform patch anchor mismatch ({count}): {old[:120]}')
    transform = transform.replace(old, new, 1)

worker_replacements = [
    (
        "    const targetTable = toTable(targetSheet, [targetKeyColumn, targetStatusColumn])",
        "    const targetTable = toTable(targetSheet, [targetKeyColumn])",
    ),
    (
        "    if (plan.targetSprintColumnCreated) {\n      const headerStyleId = getCell(targetSheet, targetTable.headerRow, Math.max(1, plan.targetSprintColumn - 1))?.styleId\n      setCell(targetSheet, targetTable.headerRow, plan.targetSprintColumn, targetSprintColumn, headerStyleId)\n    }",
        "    if (plan.targetStatusColumnCreated) {\n      const headerStyleId = getCell(targetSheet, targetTable.headerRow, Math.max(1, plan.targetStatusColumn - 1))?.styleId\n      setCell(targetSheet, targetTable.headerRow, plan.targetStatusColumn, targetStatusColumn, headerStyleId)\n    }\n    if (plan.targetSprintColumnCreated) {\n      const headerStyleId = getCell(targetSheet, targetTable.headerRow, Math.max(1, plan.targetSprintColumn - 1))?.styleId\n      setCell(targetSheet, targetTable.headerRow, plan.targetSprintColumn, targetSprintColumn, headerStyleId)\n    }",
    ),
    (
        "      const fallbackStyle = update.reason === 'sprint'\n        ? getCell(targetSheet, update.row, Math.max(1, update.column - 1))?.styleId\n        : undefined",
        "      const needsAdjacentStyle = (update.reason === 'status' && plan.targetStatusColumnCreated)\n        || (update.reason === 'sprint' && plan.targetSprintColumnCreated)\n      const fallbackStyle = needsAdjacentStyle\n        ? getCell(targetSheet, update.row, Math.max(1, update.column - 1))?.styleId\n        : undefined",
    ),
    (
        "    if (getMaxCol(qaSheet) < originalTargetMaxCol || getMaxCol(qaSheet) > originalTargetMaxCol + (plan.targetSprintColumnCreated ? 1 : 0)) {",
        "    const createdColumnCount = Number(plan.targetStatusColumnCreated) + Number(plan.targetSprintColumnCreated)\n    if (getMaxCol(qaSheet) < originalTargetMaxCol || getMaxCol(qaSheet) > originalTargetMaxCol + createdColumnCount) {",
    ),
]

for old, new in worker_replacements:
    count = worker.count(old)
    if count != 1:
        raise SystemExit(f'Worker patch anchor mismatch ({count}): {old[:120]}')
    worker = worker.replace(old, new, 1)

assistant_old = """      const { data, error } = await client.functions.invoke('spreadsheet-execute', { body: request })
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('Spreadsheet worker boş veya geçersiz sonuç döndürdü.')"""
assistant_new = """      const { data, error } = await client.functions.invoke('spreadsheet-execute', { body: request })
      if (error) {
        let workerDetail = ''
        try {
          const context = (error as any)?.context
          const payload = context && typeof context.json === 'function' ? await context.json() : null
          workerDetail = clean(payload?.error || payload?.message, 2_000)
        } catch { /* best-effort worker error detail */ }
        throw new Error(workerDetail || clean((error as any)?.message, 2_000) || 'Spreadsheet worker çağrısı başarısız oldu.')
      }
      if (!data || typeof data !== 'object') throw new Error('Spreadsheet worker boş veya geçersiz sonuç döndürdü.')"""
if assistant_tool.count(assistant_old) != 1:
    raise SystemExit(f'Assistant tool patch anchor mismatch ({assistant_tool.count(assistant_old)})')
assistant_tool = assistant_tool.replace(assistant_old, assistant_new, 1)

transform_path.write_text(transform)
worker_path.write_text(worker)
assistant_tool_path.write_text(assistant_tool)

test_path.write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\nimport { planSpreadsheetJiraSync } from '../../../supabase/functions/_shared/spreadsheetTransform.ts'\n\nconst workerSource = readFileSync(\n  new URL('../../../supabase/functions/spreadsheet-execute/index.ts', import.meta.url),\n  'utf8',\n)\nconst assistantToolSource = readFileSync(\n  new URL('../../../supabase/functions/_shared/spreadsheetAssistantTool.ts', import.meta.url),\n  'utf8',\n)\n\ndescribe('Spreadsheet missing output column handling', () => {\n  it('creates both requested output columns when the target only has the Jira key', () => {\n    const target = {\n      headerRow: 1,\n      headers: ['JIRA', 'STORY'],\n      rows: [['EFA-1', 'Birinci'], ['EFA-2', 'İkinci']],\n    }\n    const jira = {\n      headerRow: 1,\n      headers: ['JIRA No', 'Status', 'Sprint'],\n      rows: [['EFA-1', 'Done', 'EN-Fast Sprint 102'], ['EFA-2', 'In Progress', 'EN-Fast Sprint 103']],\n    }\n\n    const plan = planSpreadsheetJiraSync(target, jira, {\n      targetKeyColumn: 'JIRA',\n      jiraKeyColumn: 'JIRA No',\n      jiraStatusColumn: 'Status',\n      targetStatusColumn: 'Durum',\n      doneStatuses: ['Done', 'Closed'],\n      completedValue: 'tamamlandı',\n      jiraSprintColumn: 'Sprint',\n      targetSprintColumn: 'Enfast Sprint',\n      sprintNamePattern: 'EN-Fast',\n    })\n\n    expect(plan.targetStatusColumnCreated).toBe(true)\n    expect(plan.targetSprintColumnCreated).toBe(true)\n    expect(plan.targetStatusColumn).toBe(3)\n    expect(plan.targetSprintColumn).toBe(4)\n    expect(plan.updates).toEqual(expect.arrayContaining([\n      expect.objectContaining({ row: 2, column: 3, value: 'tamamlandı', reason: 'status' }),\n      expect.objectContaining({ row: 2, column: 4, value: 'EN-Fast Sprint 102', reason: 'sprint' }),\n    ]))\n  })\n\n  it('does not require a pre-existing target status column before planning the worker update', () => {\n    expect(workerSource).toContain('toTable(targetSheet, [targetKeyColumn])')\n    expect(workerSource).toContain('plan.targetStatusColumnCreated')\n    expect(workerSource).toContain('createdColumnCount')\n  })\n\n  it('surfaces the worker response error instead of only the generic non-2xx wrapper', () => {\n    expect(assistantToolSource).toContain("typeof context.json === 'function'")\n    expect(assistantToolSource).toContain('workerDetail')\n  })\n})\n""")

workflow_path.unlink(missing_ok=True)
script_path.unlink(missing_ok=True)
