export type SpreadsheetScalar = string | number | boolean | null

export interface SpreadsheetTable {
  headerRow: number
  headers: string[]
  rows: SpreadsheetScalar[][]
}

export interface SpreadsheetJiraSyncConfig {
  targetKeyColumn: string
  jiraKeyColumn: string
  jiraStatusColumn: string
  targetStatusColumn: string
  doneStatuses: string[]
  completedValue: SpreadsheetScalar
  jiraSprintColumn: string
  targetSprintColumn: string
  sprintNamePattern?: string | null
}

export interface SpreadsheetCellUpdate {
  row: number
  column: number
  value: SpreadsheetScalar
  reason: 'status' | 'sprint'
}

export interface SpreadsheetJiraSyncPlan {
  updates: SpreadsheetCellUpdate[]
  targetStatusColumn: number
  targetSprintColumn: number
  targetSprintColumnCreated: boolean
  matchedRows: number
  unmatchedRows: number
  completedRows: number
  sprintRows: number
  duplicateJiraKeys: number
  warnings: string[]
}

const normalizeText = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

export const normalizeSpreadsheetKey = (value: unknown) => normalizeText(value).toLocaleUpperCase('en-US')

const columnIndex = (headers: string[], name: string) => {
  const target = normalizeText(name)
  return headers.findIndex(header => normalizeText(header) === target)
}

const requireColumn = (headers: string[], name: string, side: 'target' | 'jira') => {
  const index = columnIndex(headers, name)
  if (index < 0) throw new Error(`${side === 'target' ? 'Hedef' : 'Jira'} tabloda "${name}" kolonu bulunamadı.`)
  return index
}

const sprintTokens = (value: unknown) => String(value ?? '')
  .split(/[\n,;|]+/u)
  .map(token => token.trim())
  .filter(Boolean)

const sprintSequence = (value: string) => {
  const matches = value.match(/\d+/g)
  if (!matches?.length) return Number.NEGATIVE_INFINITY
  return Math.max(...matches.map(Number).filter(Number.isFinite))
}

export function pickLatestSprint(values: unknown[], pattern?: string | null): string | null {
  const all = values.flatMap(sprintTokens)
  if (!all.length) return null
  const normalizedPattern = normalizeText(pattern || '')
  const filtered = normalizedPattern
    ? all.filter(value => normalizeText(value).includes(normalizedPattern))
    : all
  const candidates = filtered.length ? filtered : all
  return [...candidates]
    .map((value, index) => ({ value, sequence: sprintSequence(value), index }))
    .sort((left, right) => right.sequence - left.sequence || right.index - left.index)[0]?.value || null
}

const uniqueNormalized = (values: string[]) => new Set(values.map(normalizeText).filter(Boolean))

export function planSpreadsheetJiraSync(
  target: SpreadsheetTable,
  jira: SpreadsheetTable,
  config: SpreadsheetJiraSyncConfig,
): SpreadsheetJiraSyncPlan {
  const targetKeyIndex = requireColumn(target.headers, config.targetKeyColumn, 'target')
  const jiraKeyIndex = requireColumn(jira.headers, config.jiraKeyColumn, 'jira')
  const jiraStatusIndex = requireColumn(jira.headers, config.jiraStatusColumn, 'jira')
  const targetStatusIndex = requireColumn(target.headers, config.targetStatusColumn, 'target')
  const jiraSprintIndex = requireColumn(jira.headers, config.jiraSprintColumn, 'jira')
  const existingTargetSprintIndex = columnIndex(target.headers, config.targetSprintColumn)
  const targetSprintIndex = existingTargetSprintIndex >= 0 ? existingTargetSprintIndex : target.headers.length
  const doneStatuses = uniqueNormalized(config.doneStatuses)

  const jiraByKey = new Map<string, { statuses: SpreadsheetScalar[]; sprints: SpreadsheetScalar[]; count: number }>()
  let duplicateJiraKeys = 0
  for (const row of jira.rows) {
    const key = normalizeSpreadsheetKey(row[jiraKeyIndex])
    if (!key) continue
    const current = jiraByKey.get(key)
    if (current) {
      current.count += 1
      current.statuses.push(row[jiraStatusIndex] ?? null)
      current.sprints.push(row[jiraSprintIndex] ?? null)
      duplicateJiraKeys += 1
    } else {
      jiraByKey.set(key, {
        statuses: [row[jiraStatusIndex] ?? null],
        sprints: [row[jiraSprintIndex] ?? null],
        count: 1,
      })
    }
  }

  const updates: SpreadsheetCellUpdate[] = []
  let matchedRows = 0
  let unmatchedRows = 0
  let completedRows = 0
  let sprintRows = 0

  target.rows.forEach((row, rowIndex) => {
    const key = normalizeSpreadsheetKey(row[targetKeyIndex])
    if (!key) return
    const jiraRecord = jiraByKey.get(key)
    if (!jiraRecord) {
      unmatchedRows += 1
      return
    }
    matchedRows += 1
    const excelRow = target.headerRow + 1 + rowIndex
    const isDone = jiraRecord.statuses.some(status => doneStatuses.has(normalizeText(status)))
    if (isDone) {
      updates.push({
        row: excelRow,
        column: targetStatusIndex + 1,
        value: config.completedValue,
        reason: 'status',
      })
      completedRows += 1
    }
    const latestSprint = pickLatestSprint(jiraRecord.sprints, config.sprintNamePattern)
    if (latestSprint) {
      updates.push({
        row: excelRow,
        column: targetSprintIndex + 1,
        value: latestSprint,
        reason: 'sprint',
      })
      sprintRows += 1
    }
  })

  const warnings: string[] = []
  if (unmatchedRows > 0) warnings.push(`${unmatchedRows} hedef satır için Jira eşleşmesi bulunamadı.`)
  if (duplicateJiraKeys > 0) warnings.push(`${duplicateJiraKeys} ek Jira kaydı aynı issue key altında birleştirildi.`)
  if (existingTargetSprintIndex < 0) warnings.push(`"${config.targetSprintColumn}" kolonu hedef dosyaya eklenecek.`)

  return {
    updates,
    targetStatusColumn: targetStatusIndex + 1,
    targetSprintColumn: targetSprintIndex + 1,
    targetSprintColumnCreated: existingTargetSprintIndex < 0,
    matchedRows,
    unmatchedRows,
    completedRows,
    sprintRows,
    duplicateJiraKeys,
    warnings,
  }
}
