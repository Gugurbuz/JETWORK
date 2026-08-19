import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { GoogleGenAI } from 'npm:@google/genai@1.52.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-jetwork-auto-route',
}

const AUTO_MODEL = 'auto'
const LITE_MODEL = 'gemini-3.5-flash-lite'
const FLASH_MODEL = 'gemini-3.5-flash'
const PRO_MODEL = 'gemini-3.1-pro-preview'
const BASE_CORE_SLUG = 'openai-assistant-core-v2-base'
const ROUTER_VERSION = 'auto-cascade-v1'
const MAX_ROUTER_CONTEXT_MESSAGES = 6
const MAX_ROUTER_CONTEXT_CHARS = 3_000
const MAX_ROUTER_MESSAGE_CHARS = 2_500

type Tier = 'lite' | 'flash' | 'pro'

type ClassifierUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  estimatedCostUsd: number
}

type AutoRouteDecision = {
  routedModel: string
  tier: Tier
  classifierModels: string[]
  classifierDecisions: string[]
  reasons: string[]
  deterministicFloor: Tier
  usage: ClassifierUsage[]
}

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

const parseBody = (buffer: ArrayBuffer): Record<string, any> | null => {
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null
  } catch {
    return null
  }
}

const numericUsage = (usage: unknown): Record<string, number> => {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
    const number = Number(value)
    if (Number.isFinite(number)) result[key] = number
  }
  return result
}

const addUsage = (...items: Array<Record<string, number> | undefined>) => {
  const merged: Record<string, number> = {}
  for (const item of items) {
    for (const [key, value] of Object.entries(item || {})) {
      if (Number.isFinite(value)) merged[key] = (merged[key] || 0) + value
    }
  }
  return merged
}

const priceFor = (model: string) => {
  if (model === LITE_MODEL) return { input: 0.30, output: 2.50 }
  if (model === FLASH_MODEL) return { input: 1.50, output: 9.00 }
  return { input: 2.00, output: 12.00 }
}

const classifierUsageFrom = (model: string, metadata: Record<string, unknown> | undefined): ClassifierUsage => {
  const inputTokens = Number(metadata?.promptTokenCount || 0)
  const outputTokens = Number(metadata?.candidatesTokenCount || 0)
  const reasoningTokens = Number(metadata?.thoughtsTokenCount || 0)
  const totalTokens = Number(metadata?.totalTokenCount || inputTokens + outputTokens + reasoningTokens)
  const pricing = priceFor(model)
  const estimatedCostUsd = (
    (Math.max(0, inputTokens) * pricing.input)
    + (Math.max(0, outputTokens + reasoningTokens) * pricing.output)
  ) / 1_000_000
  return { model, inputTokens, outputTokens, reasoningTokens, totalTokens, estimatedCostUsd }
}

const classifierText = (response: any) => {
  if (typeof response?.text === 'string') return response.text.trim()
  const parts = response?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part: any) => !part?.thought && typeof part?.text === 'string')
    .map((part: any) => String(part.text))
    .join('')
    .trim()
}

const tierRank = (tier: Tier) => tier === 'lite' ? 0 : tier === 'flash' ? 1 : 2
const maxTier = (left: Tier, right: Tier): Tier => tierRank(left) >= tierRank(right) ? left : right

const deterministicFloorFor = (message: string, attachments: any[]): { tier: Tier; reasons: string[] } => {
  const normalized = message.toLocaleLowerCase('tr-TR')
  const words = normalized.split(/\s+/).filter(Boolean).length
  const attachmentCharacters = attachments.reduce((sum, item) => sum + String(item?.content || '').length, 0)
  const multiStep = /\b(?:derin|detaylı|detayli|kapsamlı|kapsamli|mimari|refactor|root cause|kök neden|kok neden|uçtan uca|uctan uca|alternatifler|karşılaştır|karsilastir)\b/iu.test(message)
  const artifact = /\b(?:xlsx|excel|spreadsheet|pptx|powerpoint|sunum|docx|word|pdf|görsel|gorsel|image)\b/iu.test(message)
    && /\b(?:oluştur|olustur|hazırla|hazirla|üret|uret|düzenle|duzenle|değiştir|degistir|analiz et|incele)\b/iu.test(message)

  const reasons: string[] = []
  let tier: Tier = 'lite'
  if (attachments.length > 1 || attachmentCharacters > 20_000) {
    tier = 'flash'
    reasons.push('attachment_context')
  }
  if (message.length > 2_500 || (multiStep && words > 24)) {
    tier = 'flash'
    reasons.push('multi_step_complexity')
  }
  if (artifact) {
    tier = 'flash'
    reasons.push('artifact_orchestration')
  }
  return { tier, reasons }
}

const loadCompactContext = async (
  supabaseUrl: string,
  anonKey: string,
  authorization: string,
  workspaceId: string,
  messageId: string,
) => {
  if (!workspaceId) return ''
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data, error } = await client
    .from('messages')
    .select('role,text,created_at')
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'model'])
    .neq('id', messageId)
    .order('created_at', { ascending: false })
    .limit(MAX_ROUTER_CONTEXT_MESSAGES)
  if (error || !Array.isArray(data)) return ''
  let remaining = MAX_ROUTER_CONTEXT_CHARS
  const lines: string[] = []
  for (const row of [...data].reverse()) {
    if (remaining <= 0) break
    const role = row.role === 'user' ? 'user' : 'assistant'
    const text = cleanString(String(row.text || '').replace(/\s+/g, ' '), Math.min(600, remaining))
    if (!text) continue
    const line = `${role}: ${text}`
    lines.push(line)
    remaining -= line.length
  }
  return lines.join('\n')
}

const classify = async (input: {
  apiKey: string
  model: string
  systemInstruction: string
  prompt: string
  allowed: string[]
}) => {
  const ai = new GoogleGenAI({ apiKey: input.apiKey })
  const response = await ai.models.generateContent({
    model: input.model,
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
    config: {
      systemInstruction: input.systemInstruction,
      temperature: 0,
      maxOutputTokens: 24,
    },
  } as any)
  const text = classifierText(response).toUpperCase()
  const decision = input.allowed.find(value => text.includes(value)) || input.allowed[input.allowed.length - 1]
  return {
    decision,
    usage: classifierUsageFrom(input.model, response?.usageMetadata as Record<string, unknown> | undefined),
  }
}

const routeAuto = async (input: {
  geminiApiKey: string
  message: string
  context: string
  attachments: any[]
}) : Promise<AutoRouteDecision> => {
  const floor = deterministicFloorFor(input.message, input.attachments)
  const commonPrompt = [
    `Current user request:\n${cleanString(input.message, MAX_ROUTER_MESSAGE_CHARS)}`,
    input.context ? `Recent conversation context (continuity only, not evidence):\n${input.context}` : '',
    input.attachments.length
      ? `Attachments: ${input.attachments.slice(0, 3).map(item => `${cleanString(item?.name, 120)} (${cleanString(item?.mimeType, 80)})`).join(', ')}`
      : '',
    `Deterministic minimum tier: ${floor.tier.toUpperCase()}`,
  ].filter(Boolean).join('\n\n')

  const usage: ClassifierUsage[] = []
  const classifierModels: string[] = []
  const classifierDecisions: string[] = []
  const reasons = [...floor.reasons]

  let liteDecision = 'ESCALATE'
  try {
    const lite = await classify({
      apiKey: input.geminiApiKey,
      model: LITE_MODEL,
      systemInstruction: [
        'You are JetWork Auto routing gate. Decide whether Gemini Flash-Lite is sufficient to handle the request reliably with the normal JetWork tools and grounding guards.',
        'Output exactly USE_LITE or ESCALATE.',
        'Choose USE_LITE for routine Q&A, short technical explanations, exact enterprise identifier lookup, summarization, and single-step tool use.',
        'Choose ESCALATE for genuinely multi-step reasoning, complex debugging, conflicting constraints, long/complex document work, or difficult tool orchestration.',
        'Missing enterprise evidence is NOT a reason to escalate: Lite can use knowledge tools or honestly report that evidence is absent.',
        'Do not answer the user. Do not provide reasoning.',
      ].join(' '),
      prompt: commonPrompt,
      allowed: ['USE_LITE', 'ESCALATE'],
    })
    liteDecision = lite.decision
    usage.push(lite.usage)
    classifierModels.push(LITE_MODEL)
    classifierDecisions.push(lite.decision)
  } catch (error) {
    reasons.push('lite_classifier_error')
    console.warn('AUTO_CASCADE_LITE_CLASSIFIER_FAILED', String(error).slice(0, 500))
  }

  const needsFlash = liteDecision !== 'USE_LITE' || tierRank(floor.tier) >= tierRank('flash')
  if (!needsFlash) {
    return {
      routedModel: LITE_MODEL,
      tier: 'lite',
      classifierModels,
      classifierDecisions,
      reasons,
      deterministicFloor: floor.tier,
      usage,
    }
  }

  let flashDecision = 'USE_FLASH'
  try {
    const flash = await classify({
      apiKey: input.geminiApiKey,
      model: FLASH_MODEL,
      systemInstruction: [
        'You are the second JetWork Auto routing gate. The Lite gate escalated the task.',
        'Decide whether Gemini Flash is sufficient or the task truly requires Gemini Pro.',
        'Output exactly USE_FLASH or ESCALATE_PRO.',
        'Prefer USE_FLASH for normal multi-step analysis, moderate debugging, comparison, document synthesis, and tool orchestration.',
        'Use ESCALATE_PRO only for unusually difficult architecture/reasoning, deeply ambiguous or conflicting evidence, or very complex multi-constraint synthesis.',
        'Missing enterprise evidence is NOT a reason to choose Pro.',
        'Do not answer the user. Do not provide reasoning.',
      ].join(' '),
      prompt: commonPrompt,
      allowed: ['USE_FLASH', 'ESCALATE_PRO'],
    })
    flashDecision = flash.decision
    usage.push(flash.usage)
    classifierModels.push(FLASH_MODEL)
    classifierDecisions.push(flash.decision)
  } catch (error) {
    reasons.push('flash_classifier_error')
    console.warn('AUTO_CASCADE_FLASH_CLASSIFIER_FAILED', String(error).slice(0, 500))
  }

  if (flashDecision === 'ESCALATE_PRO') {
    reasons.push('flash_requested_pro')
    return {
      routedModel: PRO_MODEL,
      tier: 'pro',
      classifierModels,
      classifierDecisions,
      reasons,
      deterministicFloor: floor.tier,
      usage,
    }
  }

  return {
    routedModel: FLASH_MODEL,
    tier: maxTier('flash', floor.tier),
    classifierModels,
    classifierDecisions,
    reasons,
    deterministicFloor: floor.tier,
    usage,
  }
}

const classifierUsageTotals = (decision: AutoRouteDecision) => {
  const summed = decision.usage.reduce((acc, item) => addUsage(acc, {
    input_tokens: item.inputTokens,
    output_tokens: item.outputTokens,
    reasoning_tokens: item.reasoningTokens,
    total_tokens: item.totalTokens,
    estimated_cost_usd: item.estimatedCostUsd,
    primary_llm_agent_calls: 1,
    primary_llm_router_calls: 1,
  }), {} as Record<string, number>)
  return addUsage(summed, {
    auto_model_cascade_started: 1,
    auto_model_router_calls: decision.usage.length,
    auto_model_cascade_escalations: decision.tier === 'lite' ? 0 : decision.tier === 'flash' ? 1 : 2,
    ...(decision.tier !== 'lite' ? { auto_model_cascade_reached_flash: 1 } : {}),
    ...(decision.tier === 'pro' ? { auto_model_cascade_reached_pro: 1 } : {}),
    ...(decision.tier === 'lite' ? { auto_model_routed_lite: 1 } : {}),
    ...(decision.tier === 'flash' ? { auto_model_routed_flash: 1 } : {}),
    ...(decision.tier === 'pro' ? { auto_model_routed_pro: 1 } : {}),
  })
}

const persistCascadeTelemetry = async (input: {
  supabaseUrl: string
  serviceRoleKey: string
  workspaceId: string
  messageId: string
  decision: AutoRouteDecision
}) => {
  const admin = createClient(input.supabaseUrl, input.serviceRoleKey, { auth: { persistSession: false } })
  const { data: turn } = await admin
    .from('assistant_turns')
    .select('id,usage')
    .eq('workspace_id', input.workspaceId)
    .eq('message_id', input.messageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!turn?.id) return

  const mergedUsage = addUsage(
    numericUsage(turn.usage),
    classifierUsageTotals(input.decision),
  )
  await admin.from('assistant_turns').update({ usage: mergedUsage }).eq('id', turn.id)

  const { data: run } = await admin
    .from('assistant_reasoning_runs')
    .select('id,evidence_summary')
    .eq('turn_id', turn.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (run?.id) {
    const current = run.evidence_summary && typeof run.evidence_summary === 'object' && !Array.isArray(run.evidence_summary)
      ? run.evidence_summary as Record<string, unknown>
      : {}
    await admin.from('assistant_reasoning_runs').update({
      evidence_summary: {
        ...current,
        autoModelCascade: {
          version: ROUTER_VERSION,
          requestedModel: AUTO_MODEL,
          startModel: LITE_MODEL,
          routedModel: input.decision.routedModel,
          classifierModels: input.decision.classifierModels,
          classifierDecisions: input.decision.classifierDecisions,
          deterministicFloor: input.decision.deterministicFloor,
          reasons: input.decision.reasons,
        },
      },
      updated_at: new Date().toISOString(),
    }).eq('id', run.id)
  }
}

const streamUpstream = (
  upstream: Response,
  persist: () => Promise<void>,
  routeModel?: string,
) => {
  if (!upstream.body) return upstream
  const reader = upstream.body.getReader()
  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'x-jetwork-auto-route')
  if (routeModel) headers.set('x-jetwork-auto-route', routeModel)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let clientClosed = false
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!clientClosed && value) {
            try { controller.enqueue(value) }
            catch { clientClosed = true }
          }
        }
      } catch (error) {
        if (!clientClosed) {
          try { controller.error(error) } catch { /* disconnected */ }
        }
      } finally {
        try { if (!clientClosed) controller.close() } catch { /* disconnected */ }
        const runtime = (globalThis as typeof globalThis & {
          EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
        }).EdgeRuntime
        const work = persist().catch(error => {
          console.warn('AUTO_CASCADE_TELEMETRY_PERSIST_FAILED', String(error).slice(0, 500))
        })
        if (runtime?.waitUntil) runtime.waitUntil(work)
        else void work
      }
    },
  })
  return new Response(stream, { status: upstream.status, headers })
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let rawBody: ArrayBuffer
  try { rawBody = await req.arrayBuffer() }
  catch { return jsonResponse({ error: 'Request body could not be read.' }, 400) }
  const body = parseBody(rawBody)
  if (!body) return jsonResponse({ error: 'Request body is invalid.' }, 400)

  const requestedModel = cleanString(body.model || AUTO_MODEL, 80)
  const workspaceId = cleanString(body.workspaceId, 200)
  const messageId = cleanString(body.messageId, 200)
  const message = cleanString(body.message, 32_000)
  const attachments = Array.isArray(body.chatAttachments) ? body.chatAttachments.slice(0, 3) : []

  let forwardedBody = body
  let decision: AutoRouteDecision | null = null

  if (requestedModel === AUTO_MODEL) {
    if (!geminiApiKey) return jsonResponse({ error: 'GEMINI_API_KEY is required for Auto model routing.', code: 'AUTO_ROUTER_UNAVAILABLE' }, 503)
    const context = await loadCompactContext(supabaseUrl, anonKey, authorization, workspaceId, messageId)
    decision = await routeAuto({ geminiApiKey, message, context, attachments })
    forwardedBody = { ...body, model: decision.routedModel }
    console.info('AUTO_MODEL_CASCADE_ROUTE', JSON.stringify({
      version: ROUTER_VERSION,
      messageId,
      workspaceId,
      startModel: LITE_MODEL,
      routedModel: decision.routedModel,
      tier: decision.tier,
      classifierModels: decision.classifierModels,
      classifierDecisions: decision.classifierDecisions,
      deterministicFloor: decision.deterministicFloor,
      reasons: decision.reasons,
      classifierEstimatedCostUsd: decision.usage.reduce((sum, item) => sum + item.estimatedCostUsd, 0),
    }))
  }

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/${BASE_CORE_SLUG}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': `jetwork-${ROUTER_VERSION}`,
      },
      body: JSON.stringify(forwardedBody),
    })
  } catch (error) {
    return jsonResponse({ error: 'Assistant core could not be reached.', code: 'AUTO_ROUTER_CORE_UNREACHABLE' }, 502)
  }

  if (!decision || !serviceRoleKey || !workspaceId || !messageId) {
    return streamUpstream(upstream, async () => {}, decision?.routedModel)
  }
  return streamUpstream(
    upstream,
    () => persistCascadeTelemetry({ supabaseUrl, serviceRoleKey, workspaceId, messageId, decision: decision as AutoRouteDecision }),
    decision.routedModel,
  )
})
