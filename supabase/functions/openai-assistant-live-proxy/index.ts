import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import {
  QUALITY_ROUTER_VERSION,
  buildTrustedContinuationMessage,
  extractExactMessageCodes,
  extractQualityTechnicalEntities,
  isShortTechnicalContinuation,
  looksLikeEnterpriseKnowledgeList,
  normalizeQualityText,
  qualityModelForRequest,
} from '../_shared/liveQualityRouting.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'x-jetwork-quality-router, x-jetwork-quality-route, x-jetwork-quality-model',
}

const streamHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)
const unique = (values: string[], limit = 96) => [...new Set(values.map(value => cleanString(value, 320)).filter(Boolean))].slice(0, limit)
const safeLikeToken = (value: string) => value.replace(/[%_,()]/g, '').slice(0, 120)

const priorUserEntities = async (client: any, workspaceId: string, messageId: string) => {
  const { data } = await client
    .from('messages')
    .select('id,role,text,created_at')
    .eq('workspace_id', workspaceId)
    .eq('role', 'user')
    .neq('id', messageId)
    .order('created_at', { ascending: false })
    .limit(8)
  for (const row of data || []) {
    const entities = extractQualityTechnicalEntities(String(row.text || ''))
    if (entities.length) return entities
  }
  return [] as string[]
}

const verifiedFacts = async (client: any, workspaceId: string) => {
  const { data } = await client.rpc('get_assistant_verified_fact_memory', {
    p_workspace_id: workspaceId,
    p_limit: 10,
  })
  const records = Array.isArray(data) ? data : []
  return {
    refs: unique(records.map((row: any) => String(row.canonical_key || '')), 10),
    titles: unique(records.map((row: any) => String(row.title || '')), 12),
  }
}

const allowedKnowledgeSpaceIds = async (serviceClient: any, projectId: string | null) => {
  const { data, error } = await serviceClient
    .from('knowledge_spaces')
    .select('id,scope_type,project_id')
  if (error) return [] as string[]
  return (data || [])
    .filter((row: any) => row.scope_type === 'global' || (projectId && row.scope_type === 'project' && String(row.project_id || '') === projectId))
    .map((row: any) => String(row.id || ''))
    .filter(Boolean)
}

const publishedKnowledgeContext = async (input: {
  serviceClient: any
  spaceIds: string[]
  technicalEntities: string[]
  exactMessageCodes: string[]
}) => {
  if (!input.spaceIds.length) return { identifiers: [] as string[], titles: [] as string[] }
  const versions = new Map<string, any>()

  for (const code of input.exactMessageCodes.slice(0, 4)) {
    const canonicalKey = `message:${code.toLocaleLowerCase('en-US')}`
    const { data: objects } = await input.serviceClient
      .from('knowledge_objects_v2')
      .select('published_version_id,canonical_key,knowledge_space_id')
      .in('knowledge_space_id', input.spaceIds)
      .eq('publication_status', 'published')
      .eq('canonical_key', canonicalKey)
      .limit(4)
    const versionIds = unique((objects || []).map((row: any) => String(row.published_version_id || '')), 8)
    if (!versionIds.length) continue
    const { data: rows } = await input.serviceClient
      .from('knowledge_object_versions_v2')
      .select('id,title,summary,content,knowledge_space_id')
      .in('id', versionIds)
    for (const row of rows || []) versions.set(String(row.id), row)
  }

  for (const entity of input.technicalEntities.slice(0, 5)) {
    if (input.exactMessageCodes.includes(entity)) continue
    const token = safeLikeToken(entity)
    if (!token) continue
    const { data: candidateVersions } = await input.serviceClient
      .from('knowledge_object_versions_v2')
      .select('id,object_id,title,summary,content,knowledge_space_id')
      .in('knowledge_space_id', input.spaceIds)
      .or(`title.ilike.%${token}%,summary.ilike.%${token}%,content.ilike.%${token}%`)
      .limit(14)
    const objectIds = unique((candidateVersions || []).map((row: any) => String(row.object_id || '')), 20)
    if (!objectIds.length) continue
    const { data: publishedObjects } = await input.serviceClient
      .from('knowledge_objects_v2')
      .select('id,published_version_id,publication_status,knowledge_space_id')
      .in('id', objectIds)
      .in('knowledge_space_id', input.spaceIds)
      .eq('publication_status', 'published')
    const publishedIds = new Set((publishedObjects || []).map((row: any) => String(row.published_version_id || '')).filter(Boolean))
    for (const row of candidateVersions || []) {
      if (publishedIds.has(String(row.id || ''))) versions.set(String(row.id), row)
    }
  }

  const texts = [...versions.values()].map(row => [row.title, row.summary, row.content].filter(Boolean).join('\n'))
  return {
    identifiers: unique(texts.flatMap(text => extractQualityTechnicalEntities(text, 96)), 96),
    titles: unique([...versions.values()].map(row => String(row.title || '')), 12),
  }
}

const knowledgeListPrefixFor = (message: string): string | null => {
  if (!looksLikeEnterpriseKnowledgeList(message)) return null
  const normalized = normalizeQualityText(message)
  if (normalized.includes('cost') && /\b(?:hata|hatalar|mesaj|mesajlar)\b/u.test(normalized)) return 'message:zcrm_cost-'
  return null
}

const publishedListIdentifiers = async (input: {
  serviceClient: any
  spaceIds: string[]
  canonicalPrefix: string
}) => {
  if (!input.spaceIds.length || !input.canonicalPrefix) return [] as string[]
  const { data, error } = await input.serviceClient
    .from('knowledge_objects_v2')
    .select('canonical_key')
    .in('knowledge_space_id', input.spaceIds)
    .eq('publication_status', 'published')
    .ilike('canonical_key', `${input.canonicalPrefix}%`)
    .order('canonical_key', { ascending: true })
    .limit(96)
  if (error) return [] as string[]
  return unique((data || []).map((row: any) => {
    const canonical = String(row.canonical_key || '')
    return canonical.replace(/^message:/iu, '').toLocaleUpperCase('en-US')
  }), 96)
}

const enterpriseListHintFor = (message: string) => {
  if (!looksLikeEnterpriseKnowledgeList(message)) return null
  const normalized = normalizeQualityText(message)
  if (normalized.includes('cost') && /\b(?:hata|hatalar|mesaj|mesajlar)\b/u.test(normalized)) {
    return 'Bu talep CRM bilgi bankasındaki ZCRM_COST mesaj/hata kataloğunu listeleme talebidir. Modül netleştirmesi istemeden list_knowledge_catalog veya eşdeğer kurumsal knowledge capability kullan. Liste sonucundaki published ZCRM_COST kodları doğrulanmış katalog identifierlarıdır.'
  }
  return 'Bu talep kurumsal teknik bilgi bankasında listeleme/arama talebidir. Kullanıcıdan kaynakta bulunabilecek teknik bağlamı yeniden istemeden knowledge capability kullan.'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/u, '')
  const anonKey = String(Deno.env.get('SUPABASE_ANON_KEY') || '')
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let body: Record<string, any>
  try {
    body = await req.json() as Record<string, any>
  } catch {
    return jsonResponse({ error: 'Request body could not be parsed.' }, 400)
  }

  const workspaceId = cleanString(body.workspaceId, 200)
  const messageId = cleanString(body.messageId, 240)
  const originalMessage = cleanString(body.message, 32_000)
  const requestedModel = cleanString(body.model || 'auto', 80) || 'auto'
  if (!workspaceId || !messageId || !originalMessage) {
    return jsonResponse({ error: 'workspaceId, messageId and message are required.' }, 400)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data: workspace, error: workspaceError } = await userClient
    .from('workspaces')
    .select('id,project_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (workspaceError || !workspace) return jsonResponse({ error: 'Workspace access denied.' }, 403)

  const shortContinuation = isShortTechnicalContinuation(originalMessage)
  const currentEntities = extractQualityTechnicalEntities(originalMessage)
  const exactMessageCodes = extractExactMessageCodes(originalMessage)
  const listHint = enterpriseListHintFor(originalMessage)
  const listPrefix = knowledgeListPrefixFor(originalMessage)

  let priorEntities: string[] = []
  let verifiedFactRefs: string[] = []
  let verifiedTitles: string[] = []
  if (shortContinuation) {
    const [prior, facts] = await Promise.all([
      priorUserEntities(userClient, workspaceId, messageId).catch(() => [] as string[]),
      verifiedFacts(userClient, workspaceId).catch(() => ({ refs: [] as string[], titles: [] as string[] })),
    ])
    priorEntities = prior
    verifiedFactRefs = facts.refs
    verifiedTitles = facts.titles
  }

  const trustedSeedEntities = unique([
    ...currentEntities,
    ...priorEntities,
    ...verifiedFactRefs.flatMap(ref => extractQualityTechnicalEntities(ref, 16)),
  ], 24)

  let trustedIdentifiers: string[] = []
  let trustedTitles: string[] = [...verifiedTitles]
  if (serviceRoleKey && (trustedSeedEntities.length || exactMessageCodes.length || listPrefix)) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const spaceIds = await allowedKnowledgeSpaceIds(serviceClient, workspace.project_id ? String(workspace.project_id) : null)
    const [trusted, listIdentifiers] = await Promise.all([
      (trustedSeedEntities.length || exactMessageCodes.length)
        ? publishedKnowledgeContext({
            serviceClient,
            spaceIds,
            technicalEntities: trustedSeedEntities,
            exactMessageCodes,
          }).catch(() => ({ identifiers: [] as string[], titles: [] as string[] }))
        : Promise.resolve({ identifiers: [] as string[], titles: [] as string[] }),
      listPrefix
        ? publishedListIdentifiers({ serviceClient, spaceIds, canonicalPrefix: listPrefix }).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
    ])
    trustedIdentifiers = unique([...trusted.identifiers, ...listIdentifiers], 96)
    trustedTitles = unique([...trustedTitles, ...trusted.titles], 12)
  }

  const forwardedMessage = buildTrustedContinuationMessage({
    originalMessage,
    priorEntities,
    verifiedFactRefs,
    trustedIdentifiers,
    trustedTitles,
    enterpriseListHint: listHint,
  })
  const forwardedModel = qualityModelForRequest({
    requestedModel,
    message: originalMessage,
    priorEntities,
    trustedIdentifiers,
  })

  const qualityRoute = [
    forwardedMessage !== originalMessage ? 'context' : '',
    forwardedModel !== requestedModel ? 'model-floor' : '',
    listHint ? 'knowledge-list' : '',
    listPrefix && trustedIdentifiers.length ? 'source-aware-list' : '',
  ].filter(Boolean).join(',') || 'passthrough'

  console.info('ASSISTANT_QUALITY_ROUTE', JSON.stringify({
    version: QUALITY_ROUTER_VERSION,
    workspaceId,
    messageId,
    requestedModel,
    forwardedModel,
    qualityRoute,
    currentEntities,
    priorEntities,
    verifiedFactCount: verifiedFactRefs.length,
    trustedIdentifierCount: trustedIdentifiers.length,
    listPrefix,
  }))

  const upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-semantic-v2`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      apikey: anonKey,
      'Content-Type': 'application/json',
      'x-client-info': `jetwork-quality-proxy/${QUALITY_ROUTER_VERSION}`,
    },
    body: JSON.stringify({ ...body, message: forwardedMessage, model: forwardedModel }),
  })

  const responseHeaders = new Headers(upstream.headers)
  for (const [key, value] of Object.entries(streamHeaders)) responseHeaders.set(key, value)
  responseHeaders.set('X-JetWork-Quality-Router', QUALITY_ROUTER_VERSION)
  responseHeaders.set('X-JetWork-Quality-Route', qualityRoute)
  responseHeaders.set('X-JetWork-Quality-Model', forwardedModel)

  if (!upstream.body) {
    return new Response(await upstream.text().catch(() => ''), { status: upstream.status, headers: responseHeaders })
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
})
