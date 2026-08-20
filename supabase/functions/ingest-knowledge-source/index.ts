import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import JSZip from 'npm:jszip@3.10.1'
import {
  KNOWLEDGE_PARSER_VERSION,
  parseKnowledgeSource,
  type ParsedKnowledgeChunk,
  type ParsedKnowledgeObject,
} from '../_shared/knowledgeParser.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
)

const ingestionErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Unexpected ingestion error'
}

const sha256 = async (value: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const decodeTextBytes = (bytes: Uint8Array) => {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const replacementRatio = (utf8.match(/\uFFFD/g) || []).length / Math.max(utf8.length, 1)
  if (replacementRatio < 0.005) return utf8
  try {
    return new TextDecoder('windows-1254').decode(bytes)
  } catch {
    return utf8
  }
}

const bytesToBase64 = (bytes: Uint8Array) => {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize))
  }
  return btoa(binary)
}

const decodeXmlEntities = (value: string) => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))

const xmlToText = (xml: string) => decodeXmlEntities(xml
  .replace(/<w:tab\s*\/>/g, '\t')
  .replace(/<(?:w:p|a:p|text:p|row|br)[^>]*>/g, '\n')
  .replace(/<\/(?:w:p|a:p|text:p|row|tr|p|li)>/g, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n'))
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .join('\n')

const htmlToText = (html: string) => decodeXmlEntities(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<\/(?:h1|h2|h3|h4|h5|h6|p|li|tr|div|section|article)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n'))
  .trim()

const sortedZipFiles = (zip: JSZip, prefix: string, suffix: string) =>
  Object.keys(zip.files)
    .filter(name => name.startsWith(prefix) && name.endsWith(suffix))
    .sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true }))

async function extractDocxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const files = [
    'word/document.xml',
    ...sortedZipFiles(zip, 'word/header', '.xml'),
    ...sortedZipFiles(zip, 'word/footer', '.xml'),
  ]
  const parts: string[] = []
  for (const fileName of files) {
    const file = zip.file(fileName)
    if (!file) continue
    const text = xmlToText(await file.async('text'))
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

async function extractPptxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const parts: string[] = []
  for (const fileName of sortedZipFiles(zip, 'ppt/slides/slide', '.xml')) {
    const file = zip.file(fileName)
    if (!file) continue
    const text = xmlToText(await file.async('text'))
    if (text) parts.push(`## ${fileName.replace(/^ppt\/slides\/|\.xml$/g, '')}\n${text}`)
  }
  return parts.join('\n\n')
}

const extractXmlBlocks = (xml: string, tag: string) => {
  const blocks: string[] = []
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) blocks.push(match[1])
  return blocks
}

async function extractXlsxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('text').catch(() => '') || ''
  const sharedStrings = extractXmlBlocks(sharedXml, 'si').map(xmlToText)
  const sheets = sortedZipFiles(zip, 'xl/worksheets/sheet', '.xml')
  const output: string[] = []

  for (const sheetName of sheets) {
    const file = zip.file(sheetName)
    if (!file) continue
    const xml = await file.async('text')
    const rows: string[][] = []
    for (const rowBlock of extractXmlBlocks(xml, 'row')) {
      const cells: string[] = []
      const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi
      let cellMatch: RegExpExecArray | null
      while ((cellMatch = cellPattern.exec(rowBlock)) !== null) {
        const attributes = cellMatch[1]
        const body = cellMatch[2]
        const type = attributes.match(/\bt="([^"]+)"/)?.[1]
        const rawValue = body.match(/<v[^>]*>([\s\S]*?)<\/v>/i)?.[1]
          || body.match(/<t[^>]*>([\s\S]*?)<\/t>/i)?.[1]
          || ''
        const value = type === 's'
          ? sharedStrings[Number(rawValue)] || rawValue
          : xmlToText(rawValue)
        cells.push(value.trim())
      }
      if (cells.some(Boolean)) rows.push(cells)
    }
    if (rows.length) {
      output.push([
        `## ${sheetName.replace(/^xl\/worksheets\/|\.xml$/g, '')}`,
        ...rows.map(row => `| ${row.map(cell => cell.replace(/\|/g, '\\|')).join(' | ')} |`),
      ].join('\n'))
    }
  }
  return output.join('\n\n')
}

async function callGeminiGenerateText(bytes: Uint8Array, mimeType: string, fileName: string) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    throw new Error(`${fileName} dosyası için metin çıkarımı GEMINI_API_KEY gerektiriyor.`)
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          {
            text: [
              'Extract the readable content from this file as faithful Markdown.',
              'Preserve headings, tables, labels, technical identifiers, code names, API names, database/table names, and sequence/flow information.',
              'Do not summarize and do not add information that is not present in the file.',
            ].join(' '),
          },
          { inlineData: { mimeType, data: bytesToBase64(bytes) } },
        ],
      }],
      generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 16_000 },
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Gemini metin çıkarımı başarısız oldu (${response.status}): ${detail.slice(0, 500)}`)
  }
  const payload = await response.json()
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: Record<string, unknown>) => typeof part.text === 'string' ? part.text : '')
    .join('\n')
    .trim()
  if (!text) throw new Error(`${fileName} dosyasından metin çıkarılamadı.`)
  return text
}

async function extractSourceText(bytes: Uint8Array, mimeType: string, fileName: string) {
  const lowerName = fileName.toLocaleLowerCase('en-US')
  const normalizedMime = mimeType.toLocaleLowerCase('en-US')
  if (
    normalizedMime.startsWith('text/')
    || ['application/json', 'application/xml', 'image/svg+xml'].includes(normalizedMime)
    || /\.(txt|md|csv|tsv|json|xml|svg)$/i.test(lowerName)
  ) {
    const text = decodeTextBytes(bytes)
    return {
      text: normalizedMime === 'text/html' || /\.(html|htm)$/i.test(lowerName) ? htmlToText(text) : text,
      extractionMethod: 'direct_text',
    }
  }
  if (normalizedMime === 'text/html' || /\.(html|htm)$/i.test(lowerName)) {
    return { text: htmlToText(decodeTextBytes(bytes)), extractionMethod: 'html_text' }
  }
  if (/\.(docx)$/i.test(lowerName) || normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { text: await extractDocxText(bytes), extractionMethod: 'office_docx_xml' }
  }
  if (/\.(pptx)$/i.test(lowerName) || normalizedMime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return { text: await extractPptxText(bytes), extractionMethod: 'office_pptx_xml' }
  }
  if (
    /\.(xlsx)$/i.test(lowerName)
    || normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || normalizedMime === 'application/vnd.ms-excel'
  ) {
    return { text: await extractXlsxText(bytes), extractionMethod: 'office_xlsx_xml' }
  }
  return {
    text: await callGeminiGenerateText(bytes, normalizedMime || 'application/octet-stream', fileName),
    extractionMethod: 'gemini_file_extraction',
  }
}

async function callGeminiEmbedding(text: string, purpose: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return null
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: text.slice(0, 24_000) }] },
      taskType: purpose,
      outputDimensionality: 768,
    }),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null)
  const values = payload?.embedding?.values
  return Array.isArray(values) && values.length === 768 ? values.map(Number) : null
}

async function attachDocumentEmbeddings(objects: ParsedKnowledgeObject[]) {
  const configuredMaxChunks = Number(Deno.env.get('KNOWLEDGE_INGEST_MAX_EMBEDDED_CHUNKS') || 120)
  const maxChunks = Number.isFinite(configuredMaxChunks)
    ? Math.max(1, Math.min(Math.trunc(configuredMaxChunks), 240))
    : 120
  let embedded = 0
  let attempted = 0
  let skipped = 0

  for (const object of objects) {
    const chunks = (object.chunks || [{ content: object.content }]) as ParsedKnowledgeChunk[]
    object.chunks = chunks
    for (const chunk of chunks) {
      if (!chunk.content.trim()) continue
      if (attempted >= maxChunks) {
        skipped += 1
        chunk.metadata = { ...(chunk.metadata || {}), embeddingStatus: 'skipped_limit' }
        continue
      }
      attempted += 1
      const embedding = await callGeminiEmbedding(chunk.content, 'RETRIEVAL_DOCUMENT').catch(() => null)
      if (embedding) {
        chunk.embedding = embedding
        embedded += 1
        chunk.metadata = { ...(chunk.metadata || {}), embeddingStatus: 'ready' }
      } else {
        skipped += 1
        chunk.metadata = {
          ...(chunk.metadata || {}),
          embeddingStatus: Deno.env.get('GEMINI_API_KEY') ? 'failed' : 'skipped_missing_gemini_key',
        }
      }
    }
  }

  return { attempted, embedded, skipped, maxChunks }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Authentication is required.' }, 401)
  }
  if (!serviceRoleKey) {
    return jsonResponse({ error: 'Ingestion server configuration is incomplete.' }, 500)
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let jobId: string | null = null
  let sourceId: string | null = null

  try {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData.user) {
      return jsonResponse({ error: 'A valid user session is required.' }, 401)
    }
    if (authData.user.is_anonymous) {
      return jsonResponse({ error: 'Knowledge ingestion requires a permanent user account.' }, 403)
    }

    const body = await req.json()
    const knowledgeSpaceId = String(body?.knowledgeSpaceId || '').trim()
    const storagePath = String(body?.storagePath || '').trim()
    const fileName = String(body?.fileName || '').trim()
    const mimeType = String(body?.mimeType || 'text/plain').trim().toLowerCase()
    const supportedExtensions = /\.(txt|md|csv|tsv|html?|json|xml|svg|pdf|docx|pptx|xlsx)$/i
    const allowedMimeTypes = new Set([
      '',
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/tab-separated-values',
      'text/html',
      'application/json',
      'application/xml',
      'image/svg+xml',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ])

    if (!knowledgeSpaceId || !storagePath || !fileName) {
      return jsonResponse({ error: 'knowledgeSpaceId, storagePath and fileName are required.' }, 400)
    }
    if (
      storagePath.includes('..')
      || !storagePath.startsWith(`${authData.user.id}/${knowledgeSpaceId}/`)
    ) {
      return jsonResponse({ error: 'Storage path is outside the authenticated knowledge scope.' }, 403)
    }
    if (!supportedExtensions.test(fileName) || !allowedMimeTypes.has(mimeType)) {
      return jsonResponse({ error: 'Bilgi bankası TXT, MD, CSV, HTML, JSON, PDF, DOCX, PPTX ve XLSX dosyalarını destekler.' }, 415)
    }

    const { data: canWrite, error: accessError } = await client.rpc('can_write_knowledge_space', {
      target_space_id: knowledgeSpaceId,
    })
    if (accessError || !canWrite) {
      return jsonResponse({ error: 'Knowledge space access denied.' }, 403)
    }

    const { data: job, error: jobError } = await adminClient
      .from('knowledge_ingestion_jobs_v2')
      .insert({
        knowledge_space_id: knowledgeSpaceId,
        owner_id: authData.user.id,
        status: 'running',
        phase: 'reading_source',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (jobError || !job) throw jobError || new Error('Ingestion job could not be created.')
    jobId = job.id

    // The catalog row is created after the file is parsed, so the authenticated
    // Storage SELECT policy cannot authorize this new object yet. Ownership,
    // path and knowledge-space access were validated above; read the upload
    // through the server-only client to avoid that pre-catalog RLS deadlock.
    const { data: fileData, error: downloadError } = await adminClient.storage
      .from('knowledge-sources')
      .download(storagePath)
    if (downloadError || !fileData) {
      throw downloadError || new Error('Knowledge source could not be downloaded.')
    }
    if (fileData.size > 20 * 1024 * 1024) {
      throw new Error('Knowledge source exceeds the 20 MB limit.')
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer())
    const extracted = await extractSourceText(bytes, mimeType, fileName)
    const rawText = extracted.text.trim()
    if (!rawText) throw new Error('Bilgi kaynağından okunabilir metin çıkarılamadı.')
    if (new TextEncoder().encode(rawText).byteLength > 5 * 1024 * 1024) {
      throw new Error('Çıkarılan metin 5 MB sınırını aşıyor; kaynak dosyayı daha küçük bölümlere ayırın.')
    }
    const contentHash = await sha256(bytes)
    const parsed = parseKnowledgeSource(fileName, rawText)
    const embeddingStats = await attachDocumentEmbeddings(parsed.objects)

    await adminClient
      .from('knowledge_ingestion_jobs_v2')
      .update({
        phase: 'persisting_catalog',
        stats: {
          parsedObjects: parsed.objects.length,
          parsedRelations: parsed.relations.length,
          chunkCount: parsed.objects.reduce((count, object) => count + (object.chunks?.length || 0), 0),
          embeddingStats,
          extractionMethod: extracted.extractionMethod,
        },
      })
      .eq('id', jobId)

    const { data: result, error: ingestError } = await client.rpc(
      'ingest_knowledge_catalog_v2',
      {
        p_job_id: jobId,
        p_knowledge_space_id: knowledgeSpaceId,
        p_storage_path: storagePath,
        p_file_name: fileName,
        p_mime_type: mimeType,
        p_content_hash: contentHash,
        p_raw_text: rawText,
        p_parser_version: KNOWLEDGE_PARSER_VERSION,
        p_document_type: parsed.documentType,
        p_objects: parsed.objects,
        p_relations: parsed.relations,
        p_warnings: [
          ...parsed.warnings,
          ...(embeddingStats.embedded === 0 ? ['Embedding üretilemedi; hybrid arama metinsel sinyallerle çalışacak.'] : []),
        ],
      },
    )
    if (ingestError) throw ingestError
    sourceId = String(result?.sourceId || '')

    return jsonResponse({
      ...result,
      jobId,
      parsedObjects: parsed.objects.length,
      parsedRelations: parsed.relations.length,
      chunkCount: parsed.objects.reduce((count, object) => count + (object.chunks?.length || 0), 0),
      embeddingStats,
      extractionMethod: extracted.extractionMethod,
      warnings: parsed.warnings,
    })
  } catch (error) {
    const message = ingestionErrorMessage(error)
    console.error('Knowledge ingestion failed:', error)
    if (jobId) {
      await adminClient
        .from('knowledge_ingestion_jobs_v2')
        .update({
          status: 'failed',
          phase: 'failed',
          error_message: message.slice(0, 2000),
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    }
    if (sourceId) {
      await adminClient
        .from('knowledge_sources_v2')
        .update({ ingestion_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', sourceId)
    }
    return jsonResponse({ error: message, jobId }, 400)
  }
})
