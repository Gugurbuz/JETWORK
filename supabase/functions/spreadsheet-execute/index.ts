import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { fromArrayBuffer, loadWorkbook, workbookToBytes } from 'npm:@office-kit/xlsx@0.9.0/io'
import { cellValueAsPrimitive, setFormula } from 'npm:@office-kit/xlsx@0.9.0/cell'
import { addWorksheet, createWorkbook } from 'npm:@office-kit/xlsx@0.9.0/workbook'
import {
  addAutoFilter,
  getCell,
  getMaxCol,
  getMaxRow,
  makeFreezePane,
  makeSheetView,
  mergeCells,
  setCell,
  type Worksheet,
} from 'npm:@office-kit/xlsx@0.9.0/worksheet'
import { setBold, setCellBackgroundColor, setFontSize } from 'npm:@office-kit/xlsx@0.9.0/styles'
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
const MAX_MUTATED_CELLS = 100_000
const MAX_CREATE_ROWS = 2_000
const MAX_CREATE_COLUMNS = 80
const ARTIFACT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const SUPPORTED_OPERATIONS = new Set(['inspect', 'edit', 'transform', 'create', 'validate', 'jira_sync'])

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

const sanitizeSheetName = (value: unknown, fallback = 'Result') => {
  const name = clean(value || fallback, 31).replace(/[\\/*?:\[\]]/g, '-').trim()
  return name || fallback
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

const uniqueSheetName = (workbook: any, requested: string) => {
  const existing = new Set(worksheetRefs(workbook).map((ref: any) => normalize(ref.sheet?.title)))
  const base = sanitizeSheetName(requested)
  if (!existing.has(normalize(base))) return base
  for (let index = 2; index <= 99; index += 1) {
    const suffix = `-${index}`
    const candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`
    if (!existing.has(normalize(candidate))) return candidate
  }
  throw new Error('Yeni worksheet için benzersiz ad üretilemedi.')
}

const rowValues = (sheet: Worksheet, row: number, maxCol: number): SpreadsheetScalar[] => {
  const values: SpreadsheetScalar[] = []
  for (let col = 1; col <= maxCol; col += 1) values.push(toScalar(getCell(sheet, row, col)?.value ?? null))
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
    if (!required.size && nonEmpty > bestCount) { bestCount = nonEmpty; bestRow = row }
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
  const normalizedHeaders = table.headers.map(normalize)
  return {
    sheetNames: sheets.map((ref: any) => clean(ref.sheet?.title, 120)),
    selectedSheet: clean(sheet.title, 120),
    headerRow: table.headerRow,
    rowCount: Math.max(0, getMaxRow(sheet) - table.headerRow),
    columnCount: getMaxCol(sheet),
    headers: table.headers.slice(0, MAX_INSPECT_COLUMNS),
    sampleRows: table.rows.slice(0, MAX_INSPECT_ROWS).map(row => row.slice(0, MAX_INSPECT_COLUMNS)),
    blankHeaderCount: normalizedHeaders.filter(value => !value).length,
    duplicateHeaders: [...new Set(normalizedHeaders.filter((value, index) => value && normalizedHeaders.indexOf(value) !== index))],
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
  return await loadWorkbook(fromArrayBuffer(await data.arrayBuffer()))
}

const sha256Bytes = async (bytes: Uint8Array) => {
  const safeBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', safeBuffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const uploadArtifact = async (client: any, userId: string, workspaceId: string, bytes: Uint8Array, fileName: unknown) => {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Üretilen dosya 20 MB artifact sınırını aşıyor.')
  const outputName = sanitizeFileName(fileName)
  const artifactId = crypto.randomUUID()
  const outputPath = `${userId}/${workspaceId}/outputs/${artifactId}/${outputName}`
  const { error: uploadError } = await client.storage.from(ASSISTANT_FILES_BUCKET).upload(
    outputPath,
    new Blob([bytes], { type: XLSX_MIME }),
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
  return {
    attachmentId: artifactId,
    name: outputName,
    mimeType: XLSX_MIME,
    storageBucket: ASSISTANT_FILES_BUCKET,
    storagePath: outputPath,
    downloadUrl: signedData.signedUrl,
    downloadUrlExpiresInSeconds: ARTIFACT_LINK_TTL_SECONDS,
    sha256: await sha256Bytes(bytes),
    byteSize: bytes.byteLength,
  }
}

const colLettersToNumber = (letters: string) => {
  let value = 0
  for (const char of letters.toUpperCase()) {
    if (char < 'A' || char > 'Z') throw new Error(`Geçersiz kolon referansı: ${letters}`)
    value = value * 26 + char.charCodeAt(0) - 64
  }
  return value
}
const colNumberToLetters = (column: number) => {
  let value = Math.max(1, Math.trunc(column))
  let result = ''
  while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26) }
  return result
}

interface CellRange { minRow: number; maxRow: number; minCol: number; maxCol: number; a1: string }
const parseTargetRange = (sheet: Worksheet, targetValue: unknown): CellRange => {
  const target = clean(targetValue || 'used_range', 120).replace(/\$/g, '')
  const maxRow = Math.max(1, getMaxRow(sheet))
  const maxCol = Math.max(1, getMaxCol(sheet))
  if (!target || ['used_range','used-range','*','all','tum','tümü','tumu'].includes(normalize(target))) {
    return { minRow: 1, maxRow, minCol: 1, maxCol, a1: `A1:${colNumberToLetters(maxCol)}${maxRow}` }
  }
  let minRow = 0; let maxTargetRow = 0; let minCol = 0; let maxTargetCol = 0
  let match = target.match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/)
  if (match) {
    minCol = colLettersToNumber(match[1]); minRow = Number(match[2]); maxTargetCol = match[3] ? colLettersToNumber(match[3]) : minCol; maxTargetRow = match[4] ? Number(match[4]) : minRow
  } else if ((match = target.match(/^([A-Za-z]+)(?::([A-Za-z]+))?$/))) {
    minCol = colLettersToNumber(match[1]); maxTargetCol = match[2] ? colLettersToNumber(match[2]) : minCol; minRow = 1; maxTargetRow = maxRow
  } else if ((match = target.match(/^(\d+)(?::(\d+))?$/))) {
    minRow = Number(match[1]); maxTargetRow = match[2] ? Number(match[2]) : minRow; minCol = 1; maxTargetCol = maxCol
  } else {
    throw new Error(`Desteklenmeyen hücre aralığı: ${target}`)
  }
  if (minRow < 1 || minCol < 1 || maxTargetRow < minRow || maxTargetCol < minCol) throw new Error(`Geçersiz hücre aralığı: ${target}`)
  const cellCount = (maxTargetRow - minRow + 1) * (maxTargetCol - minCol + 1)
  if (cellCount > MAX_MUTATED_CELLS) throw new Error(`Tek işlemde en fazla ${MAX_MUTATED_CELLS} hücre değiştirilebilir.`)
  return { minRow, maxRow: maxTargetRow, minCol, maxCol: maxTargetCol, a1: `${colNumberToLetters(minCol)}${minRow}:${colNumberToLetters(maxTargetCol)}${maxTargetRow}` }
}

const COLOR_MAP: Record<string, string> = {
  red: 'FFFF0000', kirmizi: 'FFFF0000', kırmızı: 'FFFF0000',
  green: 'FF00B050', yesil: 'FF00B050', yeşil: 'FF00B050',
  yellow: 'FFFFFF00', sari: 'FFFFFF00', sarı: 'FFFFFF00',
  blue: 'FF4472C4', mavi: 'FF4472C4',
  orange: 'FFFFC000', turuncu: 'FFFFC000',
  gray: 'FFD9E1F2', grey: 'FFD9E1F2', gri: 'FFD9E1F2',
  black: 'FF000000', siyah: 'FF000000', white: 'FFFFFFFF', beyaz: 'FFFFFFFF',
}
const normalizeColor = (value: unknown) => {
  const raw = clean(value, 40)
  const named = COLOR_MAP[normalize(raw)]
  if (named) return named
  const hex = raw.replace(/^#/, '').toUpperCase()
  if (/^[0-9A-F]{6}$/.test(hex)) return `FF${hex}`
  if (/^[0-9A-F]{8}$/.test(hex)) return hex
  throw new Error(`Desteklenmeyen renk: ${raw || '(boş)'}. Renk adı veya #RRGGBB kullanın.`)
}

const applyCellAction = (workbook: any, sheet: Worksheet, action: Record<string, unknown>) => {
  const operation = clean(action.operation, 40)
  if (operation === 'merge_cells') {
    const range = parseTargetRange(sheet, action.target)
    mergeCells(sheet, range.a1)
    return { operation, target: range.a1, changedCells: 0 }
  }
  if (operation === 'add_filter') {
    const range = parseTargetRange(sheet, action.target)
    addAutoFilter(sheet, range.a1)
    return { operation, target: range.a1, changedCells: 0 }
  }
  if (operation === 'freeze_panes') {
    const anchor = clean(action.target || 'A2', 40)
    if (!/^[A-Za-z]+\d+$/.test(anchor)) throw new Error('Freeze pane hedefi A2 gibi tek hücre olmalıdır.')
    sheet.views.push(makeSheetView({ pane: makeFreezePane(anchor.toUpperCase()) }))
    return { operation, target: anchor.toUpperCase(), changedCells: 0 }
  }
  const range = parseTargetRange(sheet, action.target)
  let changedCells = 0
  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      const existing = getCell(sheet, row, col)
      if (operation === 'set_value') {
        setCell(sheet, row, col, action.value as SpreadsheetScalar, existing?.styleId)
      } else if (operation === 'set_formula') {
        const formula = clean(action.value, 2_000).replace(/^=/, '')
        if (!formula) throw new Error('Formül değeri boş olamaz.')
        const cell = existing || setCell(sheet, row, col, null)
        setFormula(cell, formula)
      } else if (operation === 'set_fill') {
        const cell = existing || setCell(sheet, row, col, null)
        setCellBackgroundColor(workbook, cell, normalizeColor(action.value))
      } else if (operation === 'set_bold') {
        if (action.value === false) throw new Error('set_bold şu anda yalnız bold=true destekler.')
        const cell = existing || setCell(sheet, row, col, null)
        setBold(workbook, cell)
      } else if (operation === 'set_font_size') {
        const size = Number(action.number ?? action.value)
        if (!Number.isFinite(size) || size < 6 || size > 96) throw new Error('Font size 6-96 arasında olmalıdır.')
        const cell = existing || setCell(sheet, row, col, null)
        setFontSize(workbook, cell, size)
      } else {
        throw new Error(`Desteklenmeyen edit operation: ${operation}`)
      }
      changedCells += 1
    }
  }
  return { operation, target: range.a1, changedCells }
}

const indexOfHeader = (headers: string[], requested: unknown) => {
  const key = normalize(requested)
  const index = headers.findIndex(header => normalize(header) === key)
  if (index < 0) throw new Error(`Kolon bulunamadı: ${clean(requested, 160)}`)
  return index
}
const compactCellString = (value: SpreadsheetScalar) => typeof value === 'string' ? value.replace(/[ \t\u00A0]+/g, ' ').trim() : value
const normalizeJoinKey = (value: SpreadsheetScalar) => normalize(displayScalar(value))

const writeTableToNewSheet = (workbook: any, requestedName: string, headers: string[], rows: SpreadsheetScalar[][]) => {
  if (headers.length > MAX_CREATE_COLUMNS) throw new Error(`En fazla ${MAX_CREATE_COLUMNS} kolon desteklenir.`)
  if (rows.length > MAX_CREATE_ROWS) throw new Error(`Transform çıktısı en fazla ${MAX_CREATE_ROWS} satır olabilir.`)
  const sheetName = uniqueSheetName(workbook, requestedName)
  const sheet = addWorksheet(workbook, sheetName) as Worksheet
  headers.forEach((header, index) => {
    const cell = setCell(sheet, 1, index + 1, header)
    setBold(workbook, cell)
    setCellBackgroundColor(workbook, cell, 'FFEFEFEF')
  })
  rows.forEach((row, rowIndex) => row.slice(0, headers.length).forEach((value, colIndex) => setCell(sheet, rowIndex + 2, colIndex + 1, value)))
  return sheetName
}

const transformTable = (
  table: SpreadsheetTable,
  operation: string,
  config: Record<string, unknown>,
  secondaryTable?: SpreadsheetTable,
) => {
  let headers = [...table.headers]
  let rows = table.rows.map(row => [...row])
  const warnings: string[] = []
  const sourceRows = rows.length

  if (operation === 'sort') {
    const index = indexOfHeader(headers, config.column)
    const direction = clean(config.direction, 10) === 'desc' ? -1 : 1
    rows.sort((left, right) => displayScalar(left[index] ?? null).localeCompare(displayScalar(right[index] ?? null), 'tr-TR', { numeric: true }) * direction)
  } else if (operation === 'filter') {
    const index = indexOfHeader(headers, config.column)
    const expected = normalizeJoinKey(config.equalsValue as SpreadsheetScalar)
    rows = rows.filter(row => normalizeJoinKey(row[index] ?? null) === expected)
  } else if (operation === 'deduplicate') {
    const keys = Array.isArray(config.keyColumns) ? config.keyColumns.map(String).filter(Boolean) : []
    if (!keys.length) throw new Error('Deduplicate için en az bir key column gereklidir.')
    const indexes = keys.map(key => indexOfHeader(headers, key))
    const seen = new Set<string>()
    rows = rows.filter(row => {
      const key = indexes.map(index => normalizeJoinKey(row[index] ?? null)).join('\u001f')
      if (seen.has(key)) return false
      seen.add(key); return true
    })
  } else if (operation === 'clean' || operation === 'normalize') {
    rows = rows.map(row => row.map(compactCellString))
    if (operation === 'normalize') headers = headers.map(header => header.replace(/[ \t\u00A0]+/g, ' ').trim())
  } else if (operation === 'aggregate') {
    const groupByColumns = Array.isArray(config.groupByColumns) ? config.groupByColumns.map(String).filter(Boolean) : []
    const groupIndexes = groupByColumns.map(key => indexOfHeader(headers, key))
    const aggregation = clean(config.aggregation, 20) || 'count'
    const valueIndex = aggregation === 'count' ? -1 : indexOfHeader(headers, config.valueColumn)
    const groups = new Map<string, { group: SpreadsheetScalar[]; values: number[]; count: number }>()
    for (const row of rows) {
      const group = groupIndexes.map(index => row[index] ?? null)
      const key = group.map(normalizeJoinKey).join('\u001f')
      const current = groups.get(key) || { group, values: [], count: 0 }
      current.count += 1
      if (valueIndex >= 0) {
        const numeric = Number(row[valueIndex])
        if (Number.isFinite(numeric)) current.values.push(numeric)
      }
      groups.set(key, current)
    }
    headers = [...groupByColumns, aggregation === 'count' ? 'Count' : `${aggregation} ${clean(config.valueColumn, 160)}`]
    rows = [...groups.values()].map(group => {
      let result: number
      if (aggregation === 'count') result = group.count
      else if (!group.values.length) result = 0
      else if (aggregation === 'sum') result = group.values.reduce((sum, value) => sum + value, 0)
      else if (aggregation === 'average') result = group.values.reduce((sum, value) => sum + value, 0) / group.values.length
      else if (aggregation === 'min') result = Math.min(...group.values)
      else if (aggregation === 'max') result = Math.max(...group.values)
      else throw new Error(`Desteklenmeyen aggregation: ${aggregation}`)
      return [...group.group, result]
    })
  } else if (operation === 'join') {
    if (!secondaryTable) throw new Error('Join için secondary attachment gereklidir.')
    const primaryKeys = Array.isArray(config.keyColumns) ? config.keyColumns.map(String).filter(Boolean) : []
    if (primaryKeys.length !== 1) throw new Error('Generic join v1 tek primary key column destekler.')
    const primaryIndex = indexOfHeader(headers, primaryKeys[0])
    const secondaryIndex = indexOfHeader(secondaryTable.headers, config.secondaryKeyColumn)
    const requestedCopy = Array.isArray(config.copyColumns) ? config.copyColumns.map(String).filter(Boolean) : []
    const copyIndexes = requestedCopy.map(column => indexOfHeader(secondaryTable.headers, column))
    const byKey = new Map<string, SpreadsheetScalar[]>()
    let duplicateSecondaryKeys = 0
    for (const row of secondaryTable.rows) {
      const key = normalizeJoinKey(row[secondaryIndex] ?? null)
      if (!key) continue
      if (byKey.has(key)) { duplicateSecondaryKeys += 1; continue }
      byKey.set(key, row)
    }
    if (duplicateSecondaryKeys) warnings.push(`${duplicateSecondaryKeys} duplicate secondary key için ilk kayıt kullanıldı.`)
    const targetHeaders = requestedCopy.map(column => {
      let candidate = column
      let suffix = 2
      while (headers.some(header => normalize(header) === normalize(candidate))) candidate = `${column}_${suffix++}`
      return candidate
    })
    headers = [...headers, ...targetHeaders]
    rows = rows.map(row => {
      const match = byKey.get(normalizeJoinKey(row[primaryIndex] ?? null))
      return [...row, ...copyIndexes.map(index => match?.[index] ?? null)]
    })
  } else {
    throw new Error(`Desteklenmeyen transform operation: ${operation}`)
  }

  return { headers, rows, sourceRows, outputRows: rows.length, warnings }
}

const sameStringArray = (left: string[], right: string[]) => left.length === right.length && left.every((value, index) => value === right[index])

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)
  if (Number(req.headers.get('content-length') || 0) > 2_000_000) return jsonResponse({ error: 'Request payload is too large.' }, 413)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })

  try {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData.user || authData.user.is_anonymous) return jsonResponse({ error: 'A valid permanent user session is required.' }, 401)

    const body = await req.json()
    const workspaceId = clean(body?.workspaceId, 200)
    const operation = clean(body?.operation, 40)
    if (!workspaceId || !SUPPORTED_OPERATIONS.has(operation)) return jsonResponse({ error: 'workspaceId and a supported operation are required.' }, 400)

    const { data: workspace, error: workspaceError } = await client.from('workspaces').select('id').eq('id', workspaceId).maybeSingle()
    if (workspaceError || !workspace) return jsonResponse({ error: 'Workspace access denied.' }, 403)
    const config = body?.config && typeof body.config === 'object' ? body.config as Record<string, unknown> : {}

    if (operation === 'create') {
      const headers = Array.isArray(config.headers) ? config.headers.map(value => clean(value, 240)).slice(0, MAX_CREATE_COLUMNS) : []
      const rows = Array.isArray(config.rows) ? config.rows.slice(0, MAX_CREATE_ROWS) as SpreadsheetScalar[][] : []
      if (!headers.length) return jsonResponse({ error: 'Create operation requires headers.' }, 400)
      const workbook = createWorkbook()
      const sheetName = sanitizeSheetName(config.sheetName, 'Sheet1')
      const sheet = addWorksheet(workbook, sheetName) as Worksheet
      headers.forEach((header, index) => { const cell = setCell(sheet, 1, index + 1, header); setBold(workbook, cell); setCellBackgroundColor(workbook, cell, 'FFEFEFEF') })
      rows.forEach((row, rowIndex) => row.slice(0, headers.length).forEach((value, colIndex) => setCell(sheet, rowIndex + 2, colIndex + 1, value)))
      const bytes = await workbookToBytes(workbook)
      const qa = await loadWorkbook(fromArrayBuffer(bytes))
      const qaSheet = resolveWorksheet(qa, sheetName).sheet as Worksheet
      if (getMaxCol(qaSheet) < headers.length || getMaxRow(qaSheet) < Math.min(rows.length + 1, 1)) throw new Error('QA failed: created workbook dimensions are invalid.')
      const artifact = await uploadArtifact(client, authData.user.id, workspaceId, bytes, config.fileName || 'jetwork-output.xlsx')
      return jsonResponse({ operation, artifact, summary: { sheetName, headerCount: headers.length, rowCount: rows.length, qa: { reloaded: true, workbookReadable: true } } })
    }

    const inputRef = validateFileRef(body?.input, authData.user.id, workspaceId)
    const workbook = await downloadWorkbook(client, inputRef)

    if (operation === 'inspect') return jsonResponse({ operation, file: { attachmentId: inputRef.attachmentId, name: inputRef.name }, inspection: inspectWorkbook(workbook, body?.sheetName ? clean(body.sheetName, 120) : null) })
    if (operation === 'validate') {
      const inspection = inspectWorkbook(workbook, body?.sheetName ? clean(body.sheetName, 120) : null)
      return jsonResponse({ operation, file: { attachmentId: inputRef.attachmentId, name: inputRef.name }, inspection, summary: { valid: true, workbookReadable: true, sheetCount: worksheetRefs(workbook).length } })
    }

    if (operation === 'edit') {
      const actions = Array.isArray(config.actions) ? config.actions.slice(0, 50).filter(action => action && typeof action === 'object') as Record<string, unknown>[] : []
      if (!actions.length) return jsonResponse({ error: 'Edit operation requires actions.' }, 400)
      const sheetRef = resolveWorksheet(workbook, body?.sheetName ? clean(body.sheetName, 120) : null)
      const sheet = sheetRef.sheet as Worksheet
      const originalSheetNames = worksheetRefs(workbook).map((ref: any) => clean(ref.sheet?.title, 120))
      const results: Record<string, unknown>[] = []
      let changedCells = 0
      for (const action of actions) {
        const actionName = clean(action.operation, 40)
        if (actionName === 'add_sheet') {
          const newName = uniqueSheetName(workbook, sanitizeSheetName(action.value, 'Sheet'))
          addWorksheet(workbook, newName)
          results.push({ operation: actionName, sheetName: newName, changedCells: 0 })
          continue
        }
        const result = applyCellAction(workbook, sheet, action)
        changedCells += Number(result.changedCells || 0)
        if (changedCells > MAX_MUTATED_CELLS) throw new Error(`Tek istekte en fazla ${MAX_MUTATED_CELLS} hücre değiştirilebilir.`)
        results.push(result)
      }
      const bytes = await workbookToBytes(workbook)
      const qaWorkbook = await loadWorkbook(fromArrayBuffer(bytes))
      resolveWorksheet(qaWorkbook, sheet.title)
      const expectedSheetCount = originalSheetNames.length + results.filter(result => result.operation === 'add_sheet').length
      if (worksheetRefs(qaWorkbook).length !== expectedSheetCount) throw new Error('QA failed: worksheet count does not match requested edits.')
      const outputName = config.outputFileName || `${inputRef.name.replace(/\.xlsx$/i, '')}-edited.xlsx`
      const artifact = await uploadArtifact(client, authData.user.id, workspaceId, bytes, outputName)
      return jsonResponse({ operation, artifact, summary: { selectedSheet: sheet.title, actionCount: actions.length, changedCells, qa: { reloaded: true, workbookReadable: true, worksheetCountVerified: true } }, actions: results })
    }

    if (operation === 'transform') {
      const sourceSheetRef = resolveWorksheet(workbook, body?.sheetName ? clean(body.sheetName, 120) : null)
      const sourceSheet = sourceSheetRef.sheet as Worksheet
      const sourceTable = toTable(sourceSheet)
      const transformOperation = clean(config.operation, 40)
      let secondaryTable: SpreadsheetTable | undefined
      if (transformOperation === 'join') {
        const secondaryRef = validateFileRef(body?.secondaryInput, authData.user.id, workspaceId)
        if (secondaryRef.attachmentId === inputRef.attachmentId) throw new Error('Join secondary workbook must be a different attachment in v1.')
        const secondaryWorkbook = await downloadWorkbook(client, secondaryRef)
        secondaryTable = toTable(resolveWorksheet(secondaryWorkbook, body?.secondarySheetName ? clean(body.secondarySheetName, 120) : null).sheet as Worksheet)
      }
      const transformed = transformTable(sourceTable, transformOperation, config, secondaryTable)
      const outputSheetName = writeTableToNewSheet(workbook, sanitizeSheetName(config.outputSheetName, 'JetWork Result'), transformed.headers, transformed.rows)
      const bytes = await workbookToBytes(workbook)
      const qaWorkbook = await loadWorkbook(fromArrayBuffer(bytes))
      const qaSheet = resolveWorksheet(qaWorkbook, outputSheetName).sheet as Worksheet
      if (getMaxCol(qaSheet) < transformed.headers.length) throw new Error('QA failed: transformed output columns were not persisted.')
      const outputName = config.outputFileName || `${inputRef.name.replace(/\.xlsx$/i, '')}-${transformOperation}.xlsx`
      const artifact = await uploadArtifact(client, authData.user.id, workspaceId, bytes, outputName)
      return jsonResponse({ operation, artifact, summary: { transformOperation, sourceSheet: sourceSheet.title, outputSheet: outputSheetName, sourceRows: transformed.sourceRows, outputRows: transformed.outputRows, outputColumns: transformed.headers.length, qa: { reloaded: true, outputSheetVerified: true } }, warnings: transformed.warnings })
    }

    const jiraRef = validateFileRef(body?.jiraInput, authData.user.id, workspaceId)
    if (jiraRef.attachmentId === inputRef.attachmentId) return jsonResponse({ error: 'Target workbook and Jira export must be different attachments.' }, 400)
    const jiraWorkbook = await downloadWorkbook(client, jiraRef)
    const targetSheet = resolveWorksheet(workbook, body?.sheetName ? clean(body.sheetName, 120) : null).sheet as Worksheet
    const jiraSheet = resolveWorksheet(jiraWorkbook, body?.jiraSheetName ? clean(body.jiraSheetName, 120) : null).sheet as Worksheet

    const targetKeyColumn = clean(config.targetKeyColumn, 160)
    const jiraKeyColumn = clean(config.jiraKeyColumn, 160)
    const jiraStatusColumn = clean(config.jiraStatusColumn, 160)
    const targetStatusColumn = clean(config.targetStatusColumn, 160)
    const jiraSprintColumn = clean(config.jiraSprintColumn, 160)
    const targetSprintColumn = clean(config.targetSprintColumn, 160)
    const doneStatuses = Array.isArray(config.doneStatuses) ? config.doneStatuses.map(value => clean(value, 80)).filter(Boolean).slice(0, 12) : []
    const completedValue = clean(config.completedValue, 160)
    const sprintNamePattern = config.sprintNamePattern == null ? null : clean(config.sprintNamePattern, 120)
    if (!targetKeyColumn || !jiraKeyColumn || !jiraStatusColumn || !targetStatusColumn || !jiraSprintColumn || !targetSprintColumn || !doneStatuses.length || !completedValue) return jsonResponse({ error: 'Jira sync column mapping is incomplete.' }, 400)

    const targetTable = toTable(targetSheet, [targetKeyColumn])
    const jiraTable = toTable(jiraSheet, [jiraKeyColumn, jiraStatusColumn, jiraSprintColumn])
    const originalSheetNames = worksheetRefs(workbook).map((ref: any) => clean(ref.sheet?.title, 120))
    const originalTargetMaxRow = getMaxRow(targetSheet)
    const originalTargetMaxCol = getMaxCol(targetSheet)
    const plan = planSpreadsheetJiraSync(targetTable, jiraTable, { targetKeyColumn, jiraKeyColumn, jiraStatusColumn, targetStatusColumn, doneStatuses, completedValue, jiraSprintColumn, targetSprintColumn, sprintNamePattern })

    if (plan.targetStatusColumnCreated) {
      const headerStyleId = getCell(targetSheet, targetTable.headerRow, Math.max(1, plan.targetStatusColumn - 1))?.styleId
      setCell(targetSheet, targetTable.headerRow, plan.targetStatusColumn, plan.targetStatusColumnName, headerStyleId)
    }
    if (plan.targetSprintColumnCreated) {
      const headerStyleId = getCell(targetSheet, targetTable.headerRow, Math.max(1, plan.targetSprintColumn - 1))?.styleId
      setCell(targetSheet, targetTable.headerRow, plan.targetSprintColumn, targetSprintColumn, headerStyleId)
    }
    for (const update of plan.updates) {
      const existing = getCell(targetSheet, update.row, update.column)
      const needsAdjacentStyle = (update.reason === 'status' && plan.targetStatusColumnCreated) || (update.reason === 'sprint' && plan.targetSprintColumnCreated)
      const fallbackStyle = needsAdjacentStyle ? getCell(targetSheet, update.row, Math.max(1, update.column - 1))?.styleId : undefined
      setCell(targetSheet, update.row, update.column, update.value, existing?.styleId ?? fallbackStyle)
    }

    const outputBytes = await workbookToBytes(workbook)
    const qaWorkbook = await loadWorkbook(fromArrayBuffer(outputBytes))
    const qaSheet = resolveWorksheet(qaWorkbook, targetSheet.title).sheet as Worksheet
    const qaSheetNames = worksheetRefs(qaWorkbook).map((ref: any) => clean(ref.sheet?.title, 120))
    if (!sameStringArray(originalSheetNames, qaSheetNames)) throw new Error('QA failed: workbook sheet structure changed unexpectedly.')
    if (getMaxRow(qaSheet) !== originalTargetMaxRow) throw new Error('QA failed: target row count changed unexpectedly.')
    const createdColumnCount = Number(plan.targetStatusColumnCreated) + Number(plan.targetSprintColumnCreated)
    if (getMaxCol(qaSheet) < originalTargetMaxCol || getMaxCol(qaSheet) > originalTargetMaxCol + createdColumnCount) throw new Error('QA failed: target column count changed unexpectedly.')
    for (const update of plan.updates) {
      const actual = toScalar(getCell(qaSheet, update.row, update.column)?.value ?? null)
      if (displayScalar(actual) !== displayScalar(update.value)) throw new Error(`QA failed: ${qaSheet.title}!R${update.row}C${update.column} was not persisted.`)
    }

    const outputName = config.outputFileName || `${inputRef.name.replace(/\.xlsx$/i, '')}-jetwork.xlsx`
    const artifact = await uploadArtifact(client, authData.user.id, workspaceId, outputBytes, outputName)
    return jsonResponse({
      operation,
      artifact,
      summary: {
        targetSheet: targetSheet.title, jiraSheet: jiraSheet.title, matchedRows: plan.matchedRows, unmatchedRows: plan.unmatchedRows,
        completedRows: plan.completedRows, sprintRows: plan.sprintRows, changedCells: plan.updates.length,
        targetStatusColumnName: plan.targetStatusColumnName, targetStatusColumnCreated: plan.targetStatusColumnCreated,
        targetSprintColumnCreated: plan.targetSprintColumnCreated, duplicateJiraKeys: plan.duplicateJiraKeys,
        qa: { reloaded: true, sheetStructurePreserved: true, rowCountPreserved: true, writtenCellsVerified: plan.updates.length },
      },
      warnings: plan.warnings,
    })
  } catch (error) {
    console.error('Spreadsheet execution failed:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Spreadsheet execution failed.' }, 500)
  }
})
