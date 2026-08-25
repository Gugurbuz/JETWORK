import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'

const ASSISTANT_FILES_BUCKET = 'assistant-files'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ARTIFACT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60
const MAX_FILE_BYTES = 20 * 1024 * 1024
const DEFAULT_DOCX_WORKER_URL = 'https://jetwork.vercel.app/api/docx-worker'
const DEFAULT_ENERJISA_DOCX_WORKER_URL = 'https://jetwork.vercel.app/api/enerjisa-docx-worker'
const ENERJISA_PROFILE_MARKER = '[ENERJISA_ANALYSIS_DOCX]'

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
const sanitizeFileName = (value: unknown, fallback: string) => {
  const raw = clean(value || fallback, 180)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return raw || fallback
}
const ensureDocxExtension = (name: string) => name.toLocaleLowerCase('en-US').endsWith('.docx')
  ? name
  : `${name.replace(/\.[^.]+$/u, '')}.docx`
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))
const sha256Bytes = async (bytes: Uint8Array) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function uploadArtifact(
  client: any,
  userId: string,
  workspaceId: string,
  bytes: Uint8Array,
  fileName: string,
) {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Üretilen DOCX 20 MB sınırını aşıyor.')
  const artifactId = crypto.randomUUID()
  const outputName = ensureDocxExtension(sanitizeFileName(fileName, 'jetwork-document.docx'))
  const outputPath = `${userId}/${workspaceId}/outputs/${artifactId}/${outputName}`
  const { error: uploadError } = await client.storage.from(ASSISTANT_FILES_BUCKET).upload(
    outputPath,
    new Blob([bytes], { type: DOCX_MIME }),
    { contentType: DOCX_MIME, upsert: false, cacheControl: '3600' },
  )
  if (uploadError) throw uploadError
  const { data: signedData, error: signedError } = await client.storage
    .from(ASSISTANT_FILES_BUCKET)
    .createSignedUrl(outputPath, ARTIFACT_LINK_TTL_SECONDS, { download: outputName })
  if (signedError || !signedData?.signedUrl) {
    await client.storage.from(ASSISTANT_FILES_BUCKET).remove([outputPath]).catch(() => undefined)
    throw signedError || new Error('DOCX download link could not be created.')
  }
  return {
    attachmentId: artifactId,
    name: outputName,
    mimeType: DOCX_MIME,
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
    const operation = clean(body?.operation, 40)
    const config = body?.config && typeof body.config === 'object'
      ? body.config as Record<string, unknown>
      : {}
    if (!workspaceId || operation !== 'document_create' || clean(config.format, 10) !== 'docx') {
      return jsonResponse({ error: 'docx-execute requires a DOCX document_create request.' }, 400)
    }
    const { data: workspace, error: workspaceError } = await client
      .from('workspaces').select('id').eq('id', workspaceId).maybeSingle()
    if (workspaceError || !workspace) return jsonResponse({ error: 'Workspace access denied.' }, 403)

    const headerText = typeof config.headerText === 'string' ? config.headerText.slice(0, 500) : ''
    const enerjisaProfile = headerText.trim().startsWith(ENERJISA_PROFILE_MARKER)
    const workerUrl = clean(
      enerjisaProfile
        ? Deno.env.get('ENERJISA_DOCX_PYTHON_WORKER_URL') || DEFAULT_ENERJISA_DOCX_WORKER_URL
        : Deno.env.get('DOCX_PYTHON_WORKER_URL') || DEFAULT_DOCX_WORKER_URL,
      600,
    )
    const paragraphs = Array.isArray(config.paragraphs)
      ? config.paragraphs.map(value => String(value).slice(0, 8_000)).slice(0, 500)
      : []
    const workerResponse = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        'x-client-info': enerjisaProfile
          ? 'jetwork-docx-python-worker/enerjisa-v1'
          : 'jetwork-docx-python-worker/v1',
      },
      body: JSON.stringify({
        title: config.title == null ? '' : String(config.title).slice(0, 500),
        paragraphs,
        markdown: typeof config.markdown === 'string' ? config.markdown.slice(0, 400_000) : '',
        headerText: enerjisaProfile ? '' : headerText,
        footerText: typeof config.footerText === 'string' ? config.footerText.slice(0, 500) : '',
        metadata: Array.isArray(config.metadata) ? config.metadata.slice(0, 20) : [],
        brandProfile: enerjisaProfile ? 'enerjisa_analysis' : null,
      }),
    })
    const workerPayload = await workerResponse.json().catch(() => ({})) as Record<string, unknown>
    if (!workerResponse.ok) {
      throw new Error(clean(workerPayload.error, 1_500) || `Python DOCX worker failed (${workerResponse.status}).`)
    }
    const encoded = clean(workerPayload.bytesBase64, 30_000_000)
    if (!encoded) throw new Error('Python DOCX worker returned no document bytes.')
    const bytes = base64ToBytes(encoded)
    if (bytes.byteLength < 1_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('Python DOCX worker returned an invalid DOCX package.')
    }

    const name = ensureDocxExtension(sanitizeFileName(config.fileName, 'jetwork-document.docx'))
    const artifact = await uploadArtifact(client, authData.user.id, workspaceId, bytes, name)
    const qa = workerPayload.qa && typeof workerPayload.qa === 'object'
      ? workerPayload.qa as Record<string, unknown>
      : {}
    return jsonResponse({
      operation,
      artifact,
      summary: {
        format: 'docx',
        engine: enerjisaProfile ? 'python-docx-enerjisa' : 'python-docx',
        brandProfile: enerjisaProfile ? 'enerjisa_analysis' : null,
        pythonWorker: true,
        qa,
      },
    })
  } catch (error) {
    console.error('Python DOCX artifact execution failed:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Python DOCX artifact execution failed.' }, 500)
  }
})
