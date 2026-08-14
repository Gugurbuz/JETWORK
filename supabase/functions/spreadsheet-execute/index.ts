import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { fromArrayBuffer, loadWorkbook, workbookToBytes } from 'npm:@office-kit/xlsx@0.9.0/io'
import { cellValueAsPrimitive } from 'npm:@office-kit/xlsx@0.9.0/cell'
import {
  getCell,
  getMaxCol,
  getMaxRow,
  setCell,
  type Worksheet,
} from 'npm:@office-kit/xlsx@0.9.0/worksheet'
import {
  planSpreadsheetJiraSync,
  type SpreadsheetScalar,
  type SpreadsheetTable,
} from '../_shared/spreadsheetTransform.ts'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ASSISTANT_FILES_BUCKET = 'assistant-files'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_INSPECT_ROWS = 8
const MAX_INSPECT_COLUMNS = 30
const ARTIFACT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)

const normalize = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const sanitizeFileName = (value: unknown, fallback = 'jetwork-output.xlsx') => {
  const base = clean(value || fallback, 180)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback
  return /\.xlsx$/i.test(base) ? base : `${base.replace(/\.[^.]+$/u, '')}.xlsx`
}

const toScalar = (value: unknown): SpreadsheetScalar => {
  const primitive = cellValueAsPrimitive(value as never)
  if (primitive instanceof Date) return primitive.toISOString()
  if (primitive === null || typeof primitive === 'string' || typeof primitive === 'number' || typeof primitive === 'boolean') return primitive
  return String(primitive)
}

const displayScalar = (value: SpreadsheetScalar) => value === null ? '' : String(value)

const worksheetRefs = (workbook: any) => (workbook.sheets || []).filter((ref: any) => ref?.kind === 'worksheet')

const resolveWorksheet = (workbook: any, requestedName?: string | null) => {
  const sheets = worksheetRefs(workbook)
  if (!sheets.length) throw new Error('Workbook içinde worksheet bulunamadı.')
  if (!requestedName) return sheets[0]
  const requested = normalize(requestedName)
  const match = sheets.find((ref: any) => normalize(ref.sheet?.title) === requested)
  if (!match) throw new Error(`Worksheet bulunamadı: ${requestedName}`)
  return match
}

const rowValues = (sheet: Worksheet, row: number, maxCol: number): SpreadsheetScalar[] => {
  const values: SpreadsheetScalar[] = []
  for (let col = 1; col <= maxCol; col += 1) {
    values.push(toScalar(getCell(sheet, row, col)?.value ?? null))
  }
  return values
}

const findHeaderRow = (sheet: Worksheet, requiredColumns: string[] = []) => {
  const maxRow = getMaxRow(sheet)
  const maxCol = getMaxCol(sheet)
  if (!maxRow || !maxCol) throw new Error(`Worksheet boş: ${sheet.title}`)
  const required = new Set(requiredColumns.map(normalize).filter(Boolean))
  let bestRow = 1
  let bestCount = -1
  const limit = Math.min(maxRow, 50)
  for (let row = 1; row <= limit; row += 1) {
    const values = rowValues(sheet, row, maxCol).map(displayScalar)
    const normalizedValues = new Set(values.map(normalize).filter(Boolean))
    if (required.size && [...required].every(value => normalizedValues.has(value))) return row
    const nonEmpty = values.filter(value => value.trim()).length
    if (!required.size && nonEmpty > bestCount) {
      bestCount = nonEmpty
      bestRow = row
    }
  }
  if (required.size) throw new Error(`Gerekli kolonları içeren header satırı bulunamadı: ${requiredColumns.join(', ')}`)
  return bestRow
}

const toTable = (sheet: Worksheet, requiredColumns: string[] = []): SpreadsheetTable => {
  const maxRow = getMaxRow(sheet)
  const maxCol = getMaxCol(sheet)
  const headerRow = findHeaderRow(sheet, requiredColumns)
  const headers = rowValues(sheet, headerRow, maxCol).map((value, index) => displayScalar(value).trim() || `__COLUMN_${index + 1}`)
  const rows: SpreadsheetScalar[][] = []
  for (let row = headerRow + 1; row <= maxRow; row += 1) rows.push(rowValues(sheet, row, maxCol))
  return { headerRow, headers, rows }
}

const inspectWorkbook = (workbook: any, requestedSheetName?: string | null) => {
  const sheets = worksheetRefs(workbook)
  const selected = resolveWorksheet(workbook, requestedSheetName)
  const sheet = selected.sheet as Worksheet
  const table = toTable(sheet)
  return {
    sheetNames: sheets.map((ref: any) => clean(ref.sheet?.title, 120)),
    selectedSheet: clean(sheet.title, 120),
    headerRow: table.headerRow,
    rowCount: Math.max(0, getMaxRow(sheet) - table.headerRow),
    columnCount: getMaxCol(sheet),
    headers: table.headers.slice(0, MAX_INSPECT_COLUMNS),
    sampleRows: table.rows.slice(0, MAX_INSPECT_ROWS).map(row => row.slice(0, MAX_INSPECT_COLUMNS)),
    truncatedColumns: Math.max(0, table.headers.length - MAX_INSPECT_COLUMNS),
    truncatedRows: Math.max(0, table.rows.length - MAX_INSPECT_ROWS),
  }
}

const validateFileRef = (ref: any, userId: string, workspaceId: string) => {
  const storageBucket = clean(ref?.storageBucket, 120)
  const storagePath = clean(ref?.storagePath, 1000)
  const name = clean(ref?.name, 240)
  const attachmentId = clean(ref?.attachmentId, 200)
  if (storageBucket !== ASSISTANT_FILES_BUCKET) throw new Error('Execution file bucket is not allowed.')
  const expectedPrefix = `${userId}/${workspaceId}/`
  if (!storagePath.startsWith(expectedPrefix)) throw new Error('Execution file is outside the authenticated workspace scope.')
  if (!/\.xlsx$/i.test(name)) throw new Error(`Only XLSX files are supported: ${name || 'unnamed file'}`)
  if (!attachmentId || !storagePath) throw new Error('Execution file reference is incomplete.')
  return { storageBucket, storagePath, name, attachmentId, mimeType: XLSX_MIME }
}

const downloadWorkbook = async (client: any, ref: ReturnType<typeof validateFileRef>) => {
  const { data, error } = await client.storage.from(ref.storageBucket).download(ref.storagePath)
  if (error || !data) throw error || new Error(`Dosya indirilemedi: ${ref.name}`)
  if (data.size > MAX_FILE_BYTES) throw new Error(`Dosya 20 MB sınırını aşıyor: ${ref.name}`)
  const bytes = await data.arrayBuffer()
  return await loadWorkbook(fromArrayBuffer(bytes))
}

const sha256Bytes = async (bytes: Uint8Array) => {
  const safeBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', safeBuffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const sameStringArray = (left: string[], right: string[]) => (
  left.length === right.length && left.every((value, index) => value === right[index])
)

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)
  if (Number(req.headers.get('content-length') || 0) > 64_000) return jsonResponse({ error: 'Request payload is too large.' }, 413)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  try {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData.user || authData.user.is_anonymous) {
      return jsonResponse({ error: 'A valid permanent user session is required.' }, 401)
    }

    const body = await req.json()
    const workspaceId = clean(body?.workspaceId, 200)
    const operation = clean(body?.operation, 40)
    if (!workspaceId || !['inspect', 'jira_sync'].includes(operation)) {
      return jsonResponse({ error: 'workspaceId and a supported operation are required.' }, 400)
    }

    const { data: workspace, error: workspaceError } = await client
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (workspaceError || !workspace) return jsonResponse({ error: 'Workspace access denied.' }, 403)

    const inputRef = validateFileRef(body?.input, authData.user.id, workspaceId)
    const workbook = await downloadWorkbook(client, inputRef)

    if (operation === 'inspect') {
      const inspection = inspectWorkbook(workbook, body?.sheetName ? clean(body.sheetName, 120) : null)
      return jsonResponse({ operation, file: { attachmentId: inputRef.attachmentId, name: inputRef.name }, inspection })
    }

    const jiraRef = validateFileRef(body?.jiraInput, authData.user.id, workspaceId)
    if (jiraRef.attachmentId === inputRef.attachmentId) {
      return jsonResponse({ error: 'Target workbook and Jira export must be different attachments.' }, 400)
    }
    const jiraWorkbook = await downloadWorkbook(client, jiraRef)
    const targetSheetRef = resolveWorksheet(workbook, body?.sheetName ? clean(body.sheetName, 120) : null)
    const jiraSheetRef = resolveWorksheet(jiraWorkbook, body?.jiraSheetName ? clean(body.jiraSheetName, 120) : null)
    const targetSheet = targetSheetRef.sheet as Worksheet
    const jiraSheet = jiraSheetRef.sheet as Worksheet
    const config = body?.config && typeof body.config === 'object' ? body.config as Record<string, unknown> : {}

    const targetKeyColumn = clean(config.targetKeyColumn, 160)
    const jiraKeyColumn = clean(config.jiraKeyColumn, 160)
    const jiraStatusColumn = clean(config.jiraStatusColumn, 160)
    const targetStatusColumn = clean(config.targetStatusColumn, 160)
    const jiraSprintColumn = clean(config.jiraSprintColumn, 160)
    const targetSprintColumn = clean(config.targetSprintColumn, 160)
    const doneStatuses = Array.isArray(config.doneStatuses)
      ? config.doneStatuses.map(value => clean(value, 80)).filter(Boolean).slice(0, 12)
      : []
    const completedValue = clean(config.completedValue, 160)
    const sprintNamePattern = config.sprintNamePattern == null ? null : clean(config.sprintNamePattern, 120)
    if (!targetKeyColumn || !jiraKeyColumn || !jiraStatusColumn || !targetStatusColumn || !jiraSprintColumn || !targetSprintColumn || !doneStatuses.length || !completedValue) {
      return jsonResponse({ error: 'Jira sync column mapping is incomplete.' }, 400)
    }

    const targetTable = toTable(targetSheet, [targetKeyColumn])
    const jiraTable = toTable(jiraSheet, [jiraKeyColumn, jiraStatusColumn, jiraSprintColumn])
    const originalSheetNames = worksheetRefs(workbook).map((ref: any) => clean(ref.sheet?.title, 120))
    const originalTargetMaxRow = getMaxRow(targetSheet)
    const originalTargetMaxCol = getMaxCol(targetSheet)

    const plan = planSpreadsheetJiraSync(targetTable, jiraTable, {
      targetKeyColumn,
      jiraKeyColumn,
      jiraStatusColumn,
      targetStatusColumn,
      doneStatuses,
      completedValue,
      jiraSprintColumn,
      targetSprintColumn,
      sprintNamePattern,
    })

    if (plan.targetStatusColumnCreated) {
      const headerStyleId = getCell(targetSheet, targetTable.headerRow, Math.max(1, plan.targetStatusColumn - 1))?.styleId
      setCell(targetSheet, targetTable.headerRow, plan.targetStatusColumn, targetStatusColumn, headerStyleId)
    }
    if (plan.targetSprintColumnCreated) {
      const headerStyleId = getCell(targetSheet, targetTable.headerRow, Math.max(1, plan.targetSprintColumn - 1))?.styleId
      setCell(targetSheet, targetTable.headerRow, plan.targetSprintColumn, targetSprintColumn, headerStyleId)
    }

    for (const update of plan.updates) {
      const existing = getCell(targetSheet, update.row, update.column)
      const needsAdjacentStyle = (update.reason === 'status' && plan.targetStatusColumnCreated)
        || (update.reason === 'sprint' && plan.targetSprintColumnCreated)
      const fallbackStyle = needsAdjacentStyle
        ? getCell(targetSheet, update.row, Math.max(1, update.column - 1))?.styleId
        : undefined
      setCell(targetSheet, update.row, update.column, update.value, existing?.styleId ?? fallbackStyle)
    }

    const outputBytes = await workbookToBytes(workbook)
    const qaWorkbook = await loadWorkbook(fromArrayBuffer(outputBytes))
    const qaSheetRef = resolveWorksheet(qaWorkbook, targetSheet.title)
    const qaSheet = qaSheetRef.sheet as Worksheet
    const qaSheetNames = worksheetRefs(qaWorkbook).map((ref: any) => clean(ref.sheet?.title, 120))
    if (!sameStringArray(originalSheetNames, qaSheetNames)) throw new Error('QA failed: workbook sheet structure changed unexpectedly.')
    if (getMaxRow(qaSheet) !== originalTargetMaxRow) throw new Error('QA failed: target row count changed unexpectedly.')
    const createdColumnCount = Number(plan.targetStatusColumnCreated) + Number(plan.targetSprintColumnCreated)
    if (getMaxCol(qaSheet) < originalTargetMaxCol || getMaxCol(qaSheet) > originalTargetMaxCol + createdColumnCount) {
      throw new Error('QA failed: target column count changed unexpectedly.')
    }
    for (const update of plan.updates) {
      const actual = toScalar(getCell(qaSheet, update.row, update.column)?.value ?? null)
      if (displayScalar(actual) !== displayScalar(update.value)) {
        throw new Error(`QA failed: ${qaSheet.title}!R${update.row}C${update.column} was not persisted.`)
      }
    }

    const outputName = sanitizeFileName(config.outputFileName, `${inputRef.name.replace(/\.xlsx$/i, '')}-jetwork.xlsx`)
    const artifactId = crypto.randomUUID()
    const outputPath = `${authData.user.id}/${workspaceId}/outputs/${artifactId}/${outputName}`
    const { error: uploadError } = await client.storage.from(ASSISTANT_FILES_BUCKET).upload(
      outputPath,
      new Blob([outputBytes], { type: XLSX_MIME }),
      { contentType: XLSX_MIME, upsert: false, cacheControl: '3600' },
    )
    if (uploadError) throw uploadError

    const { data: signedData, error: signedError } = await client.storage
      .from(ASSISTANT_FILES_BUCKET)
      .createSignedUrl(outputPath, ARTIFACT_LINK_TTL_SECONDS, { download: outputName })
    if (signedError || !signedData?.signedUrl) {
      await client.storage.from(ASSISTANT_FILES_BUCKET).remove([outputPath]).catch(() => undefined)
      throw signedError || new Error('Artifact download link could not be created.')
    }

    const outputHash = await sha256Bytes(outputBytes)
    return jsonResponse({
      operation,
      artifact: {
        attachmentId: artifactId,
        name: outputName,
        mimeType: XLSX_MIME,
        storageBucket: ASSISTANT_FILES_BUCKET,
        storagePath: outputPath,
        downloadUrl: signedData.signedUrl,
        downloadUrlExpiresInSeconds: ARTIFACT_LINK_TTL_SECONDS,
        sha256: outputHash,
        byteSize: outputBytes.byteLength,
      },
      summary: {
        targetSheet: targetSheet.title,
        jiraSheet: jiraSheet.title,
        matchedRows: plan.matchedRows,
        unmatchedRows: plan.unmatchedRows,
        completedRows: plan.completedRows,
        sprintRows: plan.sprintRows,
        changedCells: plan.updates.length,
        targetSprintColumnCreated: plan.targetSprintColumnCreated,
        duplicateJiraKeys: plan.duplicateJiraKeys,
        qa: {
          reloaded: true,
          sheetStructurePreserved: true,
          rowCountPreserved: true,
          writtenCellsVerified: plan.updates.length,
        },
      },
      warnings: plan.warnings,
    })
  } catch (error) {
    console.error('Spreadsheet execution failed:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Spreadsheet execution failed.' }, 500)
  }
})