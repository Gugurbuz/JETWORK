import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { fromArrayBuffer, loadWorkbook, workbookToBytes } from 'npm:@office-kit/xlsx@0.9.0/io'
import { addWorksheet, createWorkbook } from 'npm:@office-kit/xlsx@0.9.0/workbook'
import { getMaxCol, getMaxRow, setCell, type Worksheet } from 'npm:@office-kit/xlsx@0.9.0/worksheet'
import { setBold, setCellBackgroundColor } from 'npm:@office-kit/xlsx@0.9.0/styles'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ASSISTANT_FILES_BUCKET = 'assistant-files'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_CREATE_ROWS = 2_000
const MAX_CREATE_COLUMNS = 80
const ARTIFACT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})
const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)
const sanitizeFileName = (value: unknown, fallback = 'jetwork-output.xlsx') => {
  const base = clean(value || fallback, 180)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback
  return /\.xlsx$/i.test(base) ? base : `${base.replace(/\.[^.]+$/u, '')}.xlsx`
}
const sanitizeSheetName = (value: unknown, fallback = 'Bulgular') => {
  const name = clean(value || fallback, 31).replace(/[\\/*?:\[\]]/g, '-').trim()
  return name || fallback
}
const normalizeCell = (value: unknown): string | number | boolean | null => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value ?? '')
}
const sha256Bytes = async (bytes: Uint8Array) => {
  const safeBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', safeBuffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const uploadArtifact = async (
  client: any,
  userId: string,
  workspaceId: string,
  bytes: Uint8Array,
  fileName: unknown,
) => {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Üretilen XLSX 20 MB artifact sınırını aşıyor.')
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
    throw signedError || new Error('XLSX download link could not be created.')
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

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)
  if (Number(req.headers.get('content-length') || 0) > 2_000_000) return jsonResponse({ error: 'Request payload is too large.' }, 413)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
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
    const headers = Array.isArray(body?.headers)
      ? body.headers.map((value: unknown) => clean(value, 240)).slice(0, MAX_CREATE_COLUMNS)
      : []
    const rows = Array.isArray(body?.rows)
      ? body.rows.slice(0, MAX_CREATE_ROWS).map((row: unknown) => (
          Array.isArray(row) ? row.slice(0, headers.length).map(normalizeCell) : []
        ))
      : []
    const sheetName = sanitizeSheetName(body?.sheetName, 'Bulgular')
    const fileName = sanitizeFileName(body?.fileName, 'jetwork-output.xlsx')

    if (!workspaceId || !headers.length) {
      return jsonResponse({ error: 'workspaceId and at least one header are required.' }, 400)
    }

    const { data: workspace, error: workspaceError } = await client
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (workspaceError || !workspace) return jsonResponse({ error: 'Workspace access denied.' }, 403)

    const workbook = createWorkbook()
    const sheet = addWorksheet(workbook, sheetName) as Worksheet
    headers.forEach((header: string, index: number) => {
      const cell = setCell(sheet, 1, index + 1, header)
      setBold(workbook, cell)
      setCellBackgroundColor(workbook, cell, 'FFEFEFEF')
    })
    rows.forEach((row: Array<string | number | boolean | null>, rowIndex: number) => {
      row.forEach((value, colIndex) => setCell(sheet, rowIndex + 2, colIndex + 1, value))
    })

    const bytes = await workbookToBytes(workbook)
    if (bytes.byteLength < 500 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('XLSX creation returned an invalid package.')
    }

    const reloaded = await loadWorkbook(fromArrayBuffer(bytes))
    const worksheetRefs = (reloaded.sheets || []).filter((ref: any) => ref?.kind === 'worksheet')
    const reloadedSheet = worksheetRefs.find((ref: any) => clean(ref.sheet?.title, 120) === sheetName)?.sheet as Worksheet | undefined
    if (!reloadedSheet) throw new Error('XLSX QA failed: worksheet was not readable after reload.')
    if (getMaxCol(reloadedSheet) < headers.length) throw new Error('XLSX QA failed: column count is incomplete.')
    if (getMaxRow(reloadedSheet) < 1) throw new Error('XLSX QA failed: header row is missing.')

    const artifact = await uploadArtifact(client, authData.user.id, workspaceId, bytes, fileName)
    return jsonResponse({
      artifact,
      summary: {
        format: 'xlsx',
        engine: 'office-kit-xlsx',
        sheetName,
        headerCount: headers.length,
        rowCount: rows.length,
        qa: {
          reloaded: true,
          workbookReadable: true,
          columnCount: getMaxCol(reloadedSheet),
          rowCount: Math.max(0, getMaxRow(reloadedSheet) - 1),
        },
      },
    })
  } catch (error) {
    console.error('Agentic XLSX create failed:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Agentic XLSX create failed.' }, 500)
  }
})
