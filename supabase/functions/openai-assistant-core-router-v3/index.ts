import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-jetwork-auto-route,x-jetwork-auto-evidence',
}

const AUTO_MODEL = 'auto'
const LITE_MODEL = 'gemini-3.5-flash-lite'
const FLASH_MODEL = 'gemini-3.5-flash'
const PRO_MODEL = 'gemini-3.1-pro-preview'
const BASE_CORE_SLUG = 'openai-assistant-core-v2-base'
const ROUTER_VERSION = 'auto-evidence-cascade-v3'
const TECHNICAL_IDENTIFIER = /\b(?:Z[A-Z0-9_/-]{2,}(?:-\d+)?|CHECK_[A-Z0-9_]+)\b/gu

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const clean = (value: unknown, max = 320) => String(value ?? '').trim().slice(0, max)
const unique = <T>(items: T[]) => [...new Set(items)]

const complexity = (message: string, attachments: any[]) => {
  const normalized = message.toLocaleLowerCase('tr-TR')
  const words = normalized.split(/\s+/u).filter(Boolean).length
  const attachmentChars = attachments.reduce((sum, item) => sum + String(item?.content || '').length, 0)
  const questionCount = (message.match(/[?？]/gu) || []).length
  const heavy = /\b(?:derin|detaylı|detayli|kapsamlı|kapsamli|mimari|architecture|refactor|root cause|kök neden|kok neden|uçtan uca|uctan uca|alternatifler|karşılaştır|karsilastir|trade[- ]?off|performans analizi)\b/iu.test(message)
  const orchestration = /\b(?:birden fazla|ardından|sonra da|adım adım|tool|araç|entegrasyon|deploy|migration|migrate|pipeline|workflow)\b/iu.test(message)
  const artifact = /\b(?:xlsx|excel|spreadsheet|pptx|powerpoint|sunum|docx|word|pdf|görsel|gorsel|image)\b/iu.test(message)
    && /\b(?:oluştur|olustur|hazırla|hazirla|üret|uret|düzenle|duzenle|değiştir|degistir|analiz et|incele)\b/iu.test(message)
  const flash = Boolean(attachments.length || attachmentChars > 0 || message.length > 650 || words > 70 || questionCount > 1 || heavy || orchestration || artifact)
  const pro = Boolean(message.length > 4_000 || attachmentChars > 40_000 || (attachments.length > 1 && heavy) || (heavy && orchestration && words > 100) || (questionCount >= 4 && words > 140))
  return { flash, pro, heavy, orchestration, artifact, words }
}

const relationIntent = (message: string) => /(?:hangi\s+(?:mesaj|fonksiyon|metot|method|tablo|servis)|mesaj(?:ları|lari)?\s+(?:üret|uret)|çağır|cagir|calls?|kullan|uses?|ilişki|iliski|bağlı|bagli|depends?|emit|produce)/iu.test(message)

async function evidenceProfile(client: any, workspaceId: string, message: string) {
  const identifiers = unique([...message.toLocaleUpperCase('en-US').matchAll(TECHNICAL_IDENTIFIER)].map(match => match[0])).slice(0, 6)
  if (!identifiers.length) return { state: 'none', identifiers, direct: 0, references: 0, relations: 0, conflicts: 0 }

  const { data: workspace } = await client.from('workspaces').select('project_id').eq('id', workspaceId).maybeSingle()
  const [globalSpaces, projectSpaces] = await Promise.all([
    client.from('knowledge_spaces').select('id').eq('scope_type', 'global'),
    workspace?.project_id
      ? client.from('knowledge_spaces').select('id').eq('project_id', String(workspace.project_id))
      : Promise.resolve({ data: [], error: null }),
  ])
  const spaceIds = unique([
    ...((globalSpaces.data || []) as any[]).map(row => String(row.id)),
    ...((projectSpaces.data || []) as any[]).map(row => String(row.id)),
  ].filter(Boolean))
  if (!spaceIds.length) return { state: 'no_evidence', identifiers, direct: 0, references: 0, relations: 0, conflicts: 0 }

  const directRows: any[] = []
  const referenceRows: any[] = []
  for (const identifier of identifiers) {
    const canonicalNeedle = `%${identifier.toLocaleLowerCase('en-US')}%`
    const nameNeedle = `%${identifier}%`
    const [byName, byCanonical, byContent] = await Promise.all([
      client.from('knowledge_objects_v2')
        .select('id,canonical_key,object_type,name,published_version_id,knowledge_space_id')
        .eq('publication_status', 'published').in('knowledge_space_id', spaceIds).ilike('name', nameNeedle).limit(20),
      client.from('knowledge_objects_v2')
        .select('id,canonical_key,object_type,name,published_version_id,knowledge_space_id')
        .eq('publication_status', 'published').in('knowledge_space_id', spaceIds).ilike('canonical_key', canonicalNeedle).limit(20),
      client.from('knowledge_object_versions_v2')
        .select('id,object_id,content,title,summary')
        .in('knowledge_space_id', spaceIds).eq('is_current', true).ilike('content', `%${identifier}%`).limit(40),
    ])
    directRows.push(...(byName.data || []), ...(byCanonical.data || []))
    referenceRows.push(...(byContent.data || []))
  }

  const dedupDirect = [...new Map(directRows.map(row => [String(row.id), row])).values()]
  const canonicalKeys = dedupDirect.map((row: any) => String(row.canonical_key)).filter(Boolean)
  const objectIds = unique([
    ...dedupDirect.map((row: any) => String(row.id)),
    ...referenceRows.map((row: any) => String(row.object_id)),
  ].filter(Boolean))

  const [relationResult, conflictResult] = await Promise.all([
    canonicalKeys.length
      ? client.from('knowledge_relations_v2').select('id,source_canonical_key,target_canonical_key,relation_type')
        .in('knowledge_space_id', spaceIds).eq('active', true)
        .or(canonicalKeys.map((key: string) => `source_canonical_key.eq.${key},target_canonical_key.eq.${key}`).join(','))
        .limit(80)
      : Promise.resolve({ data: [], error: null }),
    canonicalKeys.length
      ? client.from('knowledge_review_items_v3').select('id,review_type,status,canonical_key,related_canonical_key')
        .in('knowledge_space_id', spaceIds).eq('status', 'open')
        .in('review_type', ['possible_conflict','low_confidence_relation'])
        .or(canonicalKeys.map((key: string) => `canonical_key.eq.${key},related_canonical_key.eq.${key}`).join(','))
        .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ])

  const direct = dedupDirect.length
  const references = unique(referenceRows.map((row: any) => String(row.object_id))).length
  const relations = (relationResult.data || []).length
  const conflicts = (conflictResult.data || []).length
  const asksRelation = relationIntent(message)

  let state: 'complete' | 'unresolved' | 'conflict' | 'no_evidence' = 'no_evidence'
  if (conflicts > 0) state = 'conflict'
  else if (direct > 0 && (!asksRelation || relations > 0 || references > 1)) state = 'complete'
  else if (direct > 0 || references > 0) state = 'unresolved'

  return { state, identifiers, direct, references, relations, conflicts, objectIds: objectIds.slice(0, 30) }
}

const chooseTier = (message: string, attachments: any[], evidence: Awaited<ReturnType<typeof evidenceProfile>>) => {
  const cx = complexity(message, attachments)
  const reasons: string[] = []
  let tier: 'lite' | 'flash' | 'pro' = 'lite'

  if (cx.pro) {
    tier = 'pro'
    reasons.push('request_complexity_pro')
  } else if (cx.flash) {
    tier = 'flash'
    reasons.push('request_complexity_flash')
  }

  if (evidence.state === 'conflict') {
    tier = 'pro'
    reasons.push('enterprise_evidence_conflict')
  } else if (evidence.state === 'unresolved' && tier === 'lite') {
    tier = 'flash'
    reasons.push('enterprise_evidence_found_unresolved')
  } else if (evidence.state === 'complete') {
    reasons.push('enterprise_evidence_complete')
  } else if (evidence.state === 'no_evidence') {
    reasons.push('enterprise_no_evidence_keep_capacity')
  }

  if (evidence.identifiers.length && tier === 'lite') reasons.push('exact_identifier_lite_start_not_lock')
  return { tier, model: tier === 'lite' ? LITE_MODEL : tier === 'flash' ? FLASH_MODEL : PRO_MODEL, reasons }
}

const forward = async (input: {
  supabaseUrl: string
  anonKey: string
  authorization: string
  body: Record<string, any>
  model: string
  evidenceState: string
}) => {
  const forwarded = {
    ...input.body,
    model: input.model,
    autoRoute: {
      version: ROUTER_VERSION,
      evidenceState: input.evidenceState,
      selectedModel: input.model,
    },
  }
  return fetch(`${input.supabaseUrl}/functions/v1/${BASE_CORE_SLUG}`, {
    method: 'POST',
    headers: {
      Authorization: input.authorization,
      apikey: input.anonKey,
      'Content-Type': 'application/json',
      'x-client-info': `jetwork-${ROUTER_VERSION}`,
    },
    body: JSON.stringify(forwarded),
  })
}

const relay = (upstream: Response, model: string, evidenceState: string) => {
  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'x-jetwork-auto-route,x-jetwork-auto-evidence')
  headers.set('x-jetwork-auto-route', model)
  headers.set('x-jetwork-auto-evidence', evidenceState)
  return new Response(upstream.body, { status: upstream.status, headers })
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = clean(Deno.env.get('SUPABASE_URL'), 500).replace(/\/$/u, '')
  const anonKey = clean(Deno.env.get('SUPABASE_ANON_KEY'), 1000)
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Router configuration or authorization missing.' }, 401)

  let body: Record<string, any>
  try {
    const parsed = await req.json()
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const requestedModel = clean(body.model || AUTO_MODEL, 80)
  if (requestedModel !== AUTO_MODEL) {
    try {
      return relay(await forward({ supabaseUrl, anonKey, authorization, body, model: requestedModel, evidenceState: 'manual_model' }), requestedModel, 'manual_model')
    } catch {
      return jsonResponse({ error: 'Assistant core could not be reached.', code: 'AUTO_ROUTER_CORE_UNREACHABLE' }, 502)
    }
  }

  const workspaceId = clean(body.workspaceId, 120)
  const message = clean(body.message, 12_000)
  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  if (!workspaceId || !message) return jsonResponse({ error: 'workspaceId and message are required.' }, 400)

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  let evidence: Awaited<ReturnType<typeof evidenceProfile>> = { state: 'none', identifiers: [], direct: 0, references: 0, relations: 0, conflicts: 0 }
  try {
    evidence = await evidenceProfile(client, workspaceId, message)
  } catch (error) {
    console.warn('AUTO_EVIDENCE_PREFLIGHT_FAILED', String(error).slice(0, 500))
  }

  const route = chooseTier(message, attachments, evidence)
  console.log('AUTO_EVIDENCE_ROUTE', JSON.stringify({
    version: ROUTER_VERSION,
    tier: route.tier,
    model: route.model,
    reasons: route.reasons,
    evidence: {
      state: evidence.state,
      identifiers: evidence.identifiers,
      direct: evidence.direct,
      references: evidence.references,
      relations: evidence.relations,
      conflicts: evidence.conflicts,
    },
  }))

  try {
    const upstream = await forward({ supabaseUrl, anonKey, authorization, body, model: route.model, evidenceState: evidence.state })
    return relay(upstream, route.model, evidence.state)
  } catch {
    return jsonResponse({ error: 'Assistant core could not be reached.', code: 'AUTO_ROUTER_CORE_UNREACHABLE' }, 502)
  }
})
