import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const EMBEDDING_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'
const MAX_LIMIT = 120
const CONCURRENCY = 4

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const clampLimit = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 60
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_LIMIT))
}

async function createDocumentEmbedding(apiKey: string, text: string): Promise<number[] | null> {
  const response = await fetch(`${EMBEDDING_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: text.slice(0, 24_000) }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    }),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null)
  const values = payload?.embedding?.values
  return Array.isArray(values) && values.length === 768 ? values.map(Number) : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)
  if (!serviceRoleKey || !geminiApiKey) return jsonResponse({ error: 'Embedding backfill environment is incomplete.' }, 500)

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError || !authData.user || authData.user.is_anonymous) {
    return jsonResponse({ error: 'A permanent authenticated user is required.' }, 401)
  }

  const body = await req.json().catch(() => ({}))
  const knowledgeSpaceId = String(body?.knowledgeSpaceId || '').trim()
  const limit = clampLimit(body?.limit)
  if (!knowledgeSpaceId) return jsonResponse({ error: 'knowledgeSpaceId is required.' }, 400)

  const { data: canWrite, error: accessError } = await client.rpc('can_write_knowledge_space', {
    target_space_id: knowledgeSpaceId,
  })
  if (accessError || !canWrite) return jsonResponse({ error: 'Knowledge space access denied.' }, 403)

  const { data: rows, error: selectError } = await admin
    .from('knowledge_chunks_v2')
    .select('id,content,metadata')
    .eq('knowledge_space_id', knowledgeSpaceId)
    .is('embedding', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (selectError) return jsonResponse({ error: selectError.message }, 500)

  let embedded = 0
  let failed = 0
  const failures: Array<{ id: string; reason: string }> = []
  const queue = [...(rows || [])]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const row = queue.shift()
      if (!row) break
      const vector = await createDocumentEmbedding(geminiApiKey, String(row.content || '')).catch(() => null)
      if (!vector) {
        failed += 1
        failures.push({ id: String(row.id), reason: 'embedding_failed' })
        continue
      }
      const { error: updateError } = await admin
        .from('knowledge_chunks_v2')
        .update({
          embedding: vector,
          metadata: { ...(row.metadata || {}), embeddingStatus: 'backfilled' },
        })
        .eq('id', row.id)
        .is('embedding', null)
      if (updateError) {
        failed += 1
        failures.push({ id: String(row.id), reason: updateError.message.slice(0, 300) })
      } else {
        embedded += 1
      }
    }
  })
  await Promise.all(workers)

  const { count: remaining } = await admin
    .from('knowledge_chunks_v2')
    .select('id', { count: 'exact', head: true })
    .eq('knowledge_space_id', knowledgeSpaceId)
    .is('embedding', null)

  return jsonResponse({
    knowledgeSpaceId,
    selected: rows?.length || 0,
    embedded,
    failed,
    remaining: remaining || 0,
    failures: failures.slice(0, 10),
  })
})
