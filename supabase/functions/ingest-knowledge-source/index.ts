import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import {
  KNOWLEDGE_PARSER_VERSION,
  parseKnowledgeSource,
} from '../_shared/knowledgeParser.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  },
)

const sha256 = async (value: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const decodeSource = (bytes: Uint8Array) => {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const replacementRatio = (utf8.match(/\uFFFD/g) || []).length / Math.max(utf8.length, 1)
  if (replacementRatio < 0.005) return utf8
  try {
    return new TextDecoder('windows-1254').decode(bytes)
  } catch {
    return utf8
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Only POST is supported.' }, 405)
  }

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
    const workspaceId = String(body?.workspaceId || '').trim()
    const storagePath = String(body?.storagePath || '').trim()
    const fileName = String(body?.fileName || '').trim()
    const mimeType = String(body?.mimeType || 'text/plain').trim().toLowerCase()
    const allowedMimeTypes = new Set(['text/plain', 'text/markdown'])

    if (!workspaceId || !storagePath || !fileName) {
      return jsonResponse({ error: 'workspaceId, storagePath and fileName are required.' }, 400)
    }
    if (
      storagePath.includes('..')
      || !storagePath.startsWith(`${authData.user.id}/${workspaceId}/`)
    ) {
      return jsonResponse({ error: 'Storage path is outside the authenticated workspace scope.' }, 403)
    }
    if (!/\.(txt|md)$/i.test(fileName) || !allowedMimeTypes.has(mimeType)) {
      return jsonResponse({ error: 'The first ingestion release supports only TXT and MD files.' }, 415)
    }

    const { data: workspace, error: workspaceError } = await client
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (workspaceError || !workspace) {
      return jsonResponse({ error: 'Workspace access denied.' }, 403)
    }

    const { data: job, error: jobError } = await adminClient
      .from('kb_ingestion_jobs')
      .insert({
        workspace_id: workspaceId,
        owner_id: authData.user.id,
        status: 'running',
        phase: 'reading_source',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (jobError || !job) throw jobError || new Error('Ingestion job could not be created.')
    jobId = job.id

    const { data: fileData, error: downloadError } = await client.storage
      .from('knowledge-sources')
      .download(storagePath)
    if (downloadError || !fileData) {
      throw downloadError || new Error('Knowledge source could not be downloaded.')
    }
    if (fileData.size > 5 * 1024 * 1024) {
      throw new Error('Knowledge source exceeds the 5 MB limit.')
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer())
    const rawText = decodeSource(bytes)
    const contentHash = await sha256(bytes)
    const parsed = parseKnowledgeSource(fileName, rawText)

    await adminClient
      .from('kb_ingestion_jobs')
      .update({
        phase: 'persisting_catalog',
        stats: {
          parsedObjects: parsed.objects.length,
          parsedRelations: parsed.relations.length,
        },
      })
      .eq('id', jobId)

    const { data: result, error: ingestError } = await client.rpc(
      'ingest_knowledge_catalog',
      {
        p_job_id: jobId,
        p_workspace_id: workspaceId,
        p_storage_path: storagePath,
        p_file_name: fileName,
        p_mime_type: mimeType,
        p_content_hash: contentHash,
        p_raw_text: rawText,
        p_parser_version: KNOWLEDGE_PARSER_VERSION,
        p_document_type: parsed.documentType,
        p_objects: parsed.objects,
        p_relations: parsed.relations,
        p_warnings: parsed.warnings,
      },
    )
    if (ingestError) throw ingestError
    sourceId = String(result?.sourceId || '')

    return jsonResponse({
      ...result,
      jobId,
      parsedObjects: parsed.objects.length,
      parsedRelations: parsed.relations.length,
      warnings: parsed.warnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected ingestion error'
    console.error('Knowledge ingestion failed:', error)
    if (jobId) {
      await adminClient
        .from('kb_ingestion_jobs')
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
        .from('kb_sources')
        .update({ ingestion_status: 'failed' })
        .eq('id', sourceId)
    }
    return jsonResponse({ error: message, jobId }, 400)
  }
})
