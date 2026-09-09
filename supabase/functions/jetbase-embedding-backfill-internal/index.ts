import { createClient } from 'npm:@supabase/supabase-js@2.99.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const batchEmbed = async (texts: string[]) => {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')
  if (texts.length === 0) return [] as number[][]

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
  const body = {
    requests: texts.map(text => ({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: text.slice(0, 24_000) }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    })),
  }

  let lastError = 'Gemini batch embedding failed.'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    })

    if (response.ok) {
      const payload = await response.json().catch(() => null)
      const embeddings = Array.isArray(payload?.embeddings) ? payload.embeddings : []
      if (embeddings.length !== texts.length) throw new Error('Gemini batch embedding returned an incomplete batch.')
      return embeddings.map((item: { values?: unknown }) => {
        const values = item?.values
        if (!Array.isArray(values) || values.length !== 768) throw new Error('Gemini batch embedding returned an invalid vector.')
        return values.map(Number)
      })
    }

    const detail = await response.text().catch(() => '')
    lastError = `Gemini batch embedding failed (${response.status}): ${detail.slice(0, 500)}`
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break
    await sleep(600 * (2 ** attempt))
  }

  throw new Error(lastError)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Worker configuration is incomplete.' }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  let requestId = ''

  try {
    const body = await req.json().catch(() => ({}))
    requestId = String(body?.requestId || '').trim()
    const suppliedSecret = String(body?.secret || '')
    if (!requestId || !suppliedSecret) return jsonResponse({ error: 'Invalid worker request.' }, 400)

    const [{ data: config, error: configError }, { data: queuedRequest, error: requestError }] = await Promise.all([
      admin.from('jetbase_internal_config_v1').select('secret').eq('key', 'embedding_backfill_webhook_secret').maybeSingle(),
      admin.from('jetbase_embedding_backfill_requests_v1').select('id,source_version_id,status,attempts').eq('id', requestId).maybeSingle(),
    ])
    if (configError) throw configError
    if (requestError) throw requestError
    if (!config?.secret || suppliedSecret !== config.secret) return jsonResponse({ error: 'Forbidden.' }, 403)
    if (!queuedRequest) return jsonResponse({ error: 'Backfill request not found.' }, 404)
    if (queuedRequest.status !== 'queued') return jsonResponse({ ok: true, ignored: true, status: queuedRequest.status })

    const { data: claimed, error: claimError } = await admin
      .from('jetbase_embedding_backfill_requests_v1')
      .update({
        status: 'running',
        attempts: Number(queuedRequest.attempts || 0) + 1,
        started_at: new Date().toISOString(),
        completed_at: null,
        error_message: null,
      })
      .eq('id', requestId)
      .eq('status', 'queued')
      .select('id,source_version_id')
      .maybeSingle()
    if (claimError) throw claimError
    if (!claimed) return jsonResponse({ ok: true, ignored: true, status: 'already_claimed' })

    const sourceVersionId = String(claimed.source_version_id)
    let embedded = 0
    let batches = 0

    for (let round = 0; round < 100; round += 1) {
      const { data: chunks, error: chunksError } = await admin
        .from('knowledge_chunks_v2')
        .select('id,content')
        .eq('source_version_id', sourceVersionId)
        .is('embedding', null)
        .order('chunk_index', { ascending: true })
        .limit(50)
      if (chunksError) throw chunksError
      if (!chunks?.length) break

      const vectors = await batchEmbed(chunks.map(chunk => String(chunk.content || '')))
      const rows = chunks.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index] }))
      const { data: applied, error: applyError } = await admin.rpc('apply_jetbase_embedding_batch_v1', {
        p_source_version_id: sourceVersionId,
        p_rows: rows,
      })
      if (applyError) throw applyError
      const appliedCount = Number(applied || 0)
      if (appliedCount !== chunks.length) throw new Error(`Embedding batch persistence mismatch: expected ${chunks.length}, applied ${appliedCount}.`)
      embedded += appliedCount
      batches += 1
    }

    const { count: remaining, error: remainingError } = await admin
      .from('knowledge_chunks_v2')
      .select('id', { count: 'exact', head: true })
      .eq('source_version_id', sourceVersionId)
      .is('embedding', null)
    if (remainingError) throw remainingError
    if ((remaining || 0) > 0) throw new Error(`Embedding completion stopped with ${remaining} chunks remaining.`)

    await admin.from('jetbase_embedding_backfill_requests_v1').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: { embedded, batches, remaining: 0, workerVersion: 'batch-v1' },
      error_message: null,
    }).eq('id', requestId)

    return jsonResponse({ ok: true, requestId, sourceVersionId, embedded, batches, remaining: 0 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('JetBase embedding backfill failed:', error)
    if (requestId) {
      await admin.from('jetbase_embedding_backfill_requests_v1').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: message.slice(0, 2000),
      }).eq('id', requestId).catch(() => undefined)
    }
    return jsonResponse({ error: message, requestId }, 500)
  }
})
