import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { createSafeStreamSink } from '../_shared/safeStreamSink.ts'
import {
  TRIVIAL_FAST_PATH_ENGINE_VERSION,
  providerForTrivialFastPathModel,
  requestTrivialAssistantResponse,
  shouldUseTrivialAssistantFastPath,
} from '../_shared/trivialAssistantFastPath.ts'
import {
  attachSemanticPlan,
  buildSemanticExecutionPlan,
  normalizeCachedSemanticPlan,
  SEMANTIC_ORCHESTRATOR_VERSION,
  type PriorExecutionContext,
  type SemanticContextMessage,
  type SemanticOrchestrationResult,
} from '../_shared/semanticOrchestrator.ts'
import { compactSemanticContextMessage } from '../_shared/conversationMemory.ts'
import { applyConversationScopeInventoryPolicy } from '../_shared/conversationScopePolicy.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}
const gatewayHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-JetWork-Stream-Gateway': 'v3',
}
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-JetWork-Stream-Gateway': 'v3' },
})
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unexpected stream gateway error.'
const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)
const boundedIntegerEnv = (name: string, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(Deno.env.get(name))
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(Math.trunc(parsed), maximum)) : fallback
}
const USER_REQUESTS_PER_MINUTE = boundedIntegerEnv('ASSISTANT_USER_REQUESTS_PER_MINUTE', 6, 1, 60)
const WORKSPACE_REQUESTS_PER_MINUTE = boundedIntegerEnv('ASSISTANT_WORKSPACE_REQUESTS_PER_MINUTE', 30, 1, 240)
const GEMINI_FLASH_LITE_MODEL = 'gemini-3.1-flash-lite'
const LEGACY_GEMINI_FLASH_LITE_MODEL = 'gemini-3.1-flash-lite-preview'
const GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview'
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol'
const CONTEXT_SENSITIVE_ACKNOWLEDGEMENTS = new Set(['tamam', 'ok', 'okay'])

interface AssistantGatewayBody {
  workspaceId?: unknown
  messageId?: unknown
  message?: unknown
  model?: unknown
  chatAttachments?: unknown
}

const parseGatewayBody = (body: ArrayBuffer): AssistantGatewayBody | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body))
    return parsed && typeof parsed === 'object' ? parsed as AssistantGatewayBody : null
  } catch {
    return null
  }
}
const sha256Text = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const logLatency = (event: string, payload: Record<string, unknown>) => console.info(event, JSON.stringify(payload))
const edgeWaitUntil = (promise: Promise<unknown>) => {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
  }).EdgeRuntime
  runtime?.waitUntil?.(promise)
}
const normalizeShortText = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
function sendEvent(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: string, payload: unknown) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
}
const fastPathStreamResponse = (input: {
  text: string
  conversationId: string
  model: string
  provider: 'openai'|'gemini'
  usage?: Record<string, number>
  cached?: boolean
}) => {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    sendEvent(controller, encoder, 'status', { type: 'status', stage: 'routing', label: 'Doğrudan kısa yanıt yolu' })
    sendEvent(controller, encoder, 'status', { type: 'status', stage: 'answering', label: 'Yanıt hazırlandı' })
    sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta: input.text })
    sendEvent(controller, encoder, 'sources', { type: 'sources', sources: [] })
    sendEvent(controller, encoder, 'completed', {
      type: 'completed', conversationId: input.conversationId, model: input.model, provider: input.provider,
      fallbackUsed: false, usage: input.usage, cached: Boolean(input.cached), reasoningEngine: TRIVIAL_FAST_PATH_ENGINE_VERSION,
    })
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
  }}), { headers: gatewayHeaders })
}

async function tryTrivialFastPath(input: {
  authorization: string
  supabaseUrl: string
  anonKey: string
  parsedBody: AssistantGatewayBody | null
  traceId: string
  gatewayReceivedAtMs: number
}): Promise<Response | null> {
  if (!input.parsedBody) return null
  const workspaceId = cleanString(input.parsedBody.workspaceId, 200)
  const messageId = cleanString(input.parsedBody.messageId, 240)
  const message = cleanString(input.parsedBody.message, 32_000)
  const model = cleanString(input.parsedBody.model, 80)
  const attachmentCount = Array.isArray(input.parsedBody.chatAttachments) ? input.parsedBody.chatAttachments.length : 0

  if (CONTEXT_SENSITIVE_ACKNOWLEDGEMENTS.has(normalizeShortText(message))) return null
  if (!workspaceId || !messageId || !message || !shouldUseTrivialAssistantFastPath({ message, model, attachmentCount })) return null

  const provider = providerForTrivialFastPathModel(model)
  const openAiApiKey = Deno.env.get('OPENAI_API_KEY') || undefined
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || undefined
  if ((provider === 'openai' && !openAiApiKey) || (provider === 'gemini' && !geminiApiKey)) return null

  const client = createClient(input.supabaseUrl, input.anonKey, {
    global: { headers: { Authorization: input.authorization } }, auth: { persistSession: false },
  })
  const requestHash = await sha256Text(JSON.stringify({ message, model, engine: TRIVIAL_FAST_PATH_ENGINE_VERSION }))
  const claimStartedAtMs = Date.now()
  const { data: claimData, error: claimError } = await client.rpc('claim_trivial_assistant_turn', {
    p_workspace_id: workspaceId,
    p_message_id: messageId,
    p_request_hash: requestHash,
    p_model: model,
    p_user_limit_per_minute: USER_REQUESTS_PER_MINUTE,
    p_workspace_limit_per_minute: WORKSPACE_REQUESTS_PER_MINUTE,
  })
  const claimCompletedAtMs = Date.now()
  if (claimError) {
    console.warn('Trivial fast-path claim unavailable; forwarding to semantic orchestrator:', claimError.message)
    return null
  }
  const claim = Array.isArray(claimData) ? claimData[0] : claimData
  if (!claim || typeof claim !== 'object') return null
  const outcome = cleanString(claim.outcome, 40)
  const conversationId = cleanString(claim.conversation_id, 200)
  const turnId = cleanString(claim.turn_id, 200)
  const leaseToken = cleanString(claim.lease_token, 200)
  logLatency('ASSISTANT_TRIVIAL_FAST_PATH', {
    traceId: input.traceId, messageId, outcome, requestedModel: model, provider,
    claimMs: claimCompletedAtMs - claimStartedAtMs,
    gatewayToClaimMs: claimCompletedAtMs - input.gatewayReceivedAtMs,
  })
  if (outcome === 'rate_limited') {
    return jsonResponse({ error: 'Çok kısa sürede fazla asistan isteği gönderildi. Lütfen bir dakika sonra tekrar deneyin.', code: 'RATE_LIMITED' }, 429)
  }
  if (outcome === 'busy' || outcome === 'in_progress') {
    return jsonResponse({ error: 'Bu çalışma alanında başka bir yanıt hâlâ hazırlanıyor.', code: 'CONVERSATION_BUSY' }, 409)
  }
  if (outcome === 'completed') {
    const cachedText = cleanString(claim.response_text, 200_000)
    const cachedModel = cleanString(claim.response_model || model, 80) || model
    if (!cachedText || !conversationId) return null
    return fastPathStreamResponse({
      text: cachedText,
      conversationId,
      model: cachedModel,
      provider: providerForTrivialFastPathModel(cachedModel),
      usage: claim.usage && typeof claim.usage === 'object' ? claim.usage as Record<string, number> : undefined,
      cached: true,
    })
  }
  if (outcome !== 'claimed' || !conversationId || !turnId || !leaseToken) return null

  const failTurn = async (detail: string) => {
    const { error } = await client.rpc('fail_trivial_assistant_turn', {
      p_turn_id: turnId, p_conversation_id: conversationId, p_lease_token: leaseToken,
      p_error_message: detail.slice(0, 2_000),
    })
    if (error) console.error('Trivial fast-path failure could not be persisted:', error)
  }
  const providerStartedAtMs = Date.now()
  let result
  try {
    result = await requestTrivialAssistantResponse({ message, model, openAiApiKey, geminiApiKey })
  } catch (providerError) {
    await failTurn(errorMessage(providerError))
    throw providerError
  }
  const providerCompletedAtMs = Date.now()
  const completionPromise = (async () => {
    const { error } = await client.rpc('complete_trivial_assistant_turn', {
      p_turn_id: turnId, p_conversation_id: conversationId, p_lease_token: leaseToken,
      p_response_text: result.text, p_usage: result.usage || {}, p_response_model: result.model, p_provider: result.provider,
    })
    if (error) {
      console.error('Trivial fast-path completion failed:', error)
      await failTurn(`completion_failed:${error.message}`)
    }
  })()
  edgeWaitUntil(completionPromise)
  logLatency('ASSISTANT_TRIVIAL_FAST_PATH_COMPLETE', {
    traceId: input.traceId, messageId, requestedModel: model, responseModel: result.model, provider: result.provider,
    providerMs: providerCompletedAtMs - providerStartedAtMs,
    gatewayToAnswerMs: providerCompletedAtMs - input.gatewayReceivedAtMs,
  })
  return fastPathStreamResponse({ text: result.text, conversationId, model: result.model, provider: result.provider, usage: result.usage })
}

const currentRequestMessage = (messageId: string, candidate: unknown) => {
  const raw = String(candidate || '')
  return raw === messageId || raw.startsWith(`${messageId}:`)
}

async function loadSemanticContext(input: {
  authorization: string
  supabaseUrl: string
  anonKey: string
  workspaceId: string
  messageId: string
}) {
  const client = createClient(input.supabaseUrl, input.anonKey, {
    global: { headers: { Authorization: input.authorization } }, auth: { persistSession: false },
  })
  const [currentResult, workspaceResult] = await Promise.all([
    client.from('messages').select('id,created_at').eq('workspace_id', input.workspaceId).eq('id', input.messageId).maybeSingle(),
    client.from('workspaces').select('title').eq('id', input.workspaceId).maybeSingle(),
  ])
  if (currentResult.error || !currentResult.data?.created_at) {
    throw currentResult.error || new Error('Current user message could not be loaded for semantic context.')
  }
  if (workspaceResult.error || !workspaceResult.data) {
    throw workspaceResult.error || new Error('Workspace access denied for semantic context.')
  }
  const currentCreatedAt = String(currentResult.data.created_at)
  const [messagesResult, priorRunsResult] = await Promise.all([
    client.from('messages')
      .select('id,role,text,created_at')
      .eq('workspace_id', input.workspaceId)
      .in('role', ['user','model'])
      .lt('created_at', currentCreatedAt)
      .order('created_at', { ascending: false })
      .limit(12),
    client.rpc('get_reasoning_debug_runs', {
      p_workspace_id: input.workspaceId,
      p_limit: 8,
      p_offset: 0,
    }),
  ])
  if (messagesResult.error) throw messagesResult.error
  if (priorRunsResult.error) {
    console.warn('Prior reasoning metadata could not be loaded for semantic context:', priorRunsResult.error.message)
  }
  const conversation: SemanticContextMessage[] = [...(messagesResult.data || [])]
    .reverse()
    .map((row: any) => {
      const role = row.role === 'user' ? 'user' as const : 'assistant' as const
      return { role, content: compactSemanticContextMessage(role, row.text) }
    })
    .filter(item => item.content)

  const previousRun = (priorRunsResult.data || []).find((row: any) => {
    const startedAt = String(row.started_at || '')
    return row.status === 'completed'
      && startedAt
      && startedAt < currentCreatedAt
      && !currentRequestMessage(input.messageId, row.message_id)
  })
  const priorExecution: PriorExecutionContext | undefined = previousRun ? {
    messageId: cleanString(previousRun.message_id, 240),
    intent: cleanString(previousRun.intent, 80),
    complexity: cleanString(previousRun.complexity, 40),
    knowledgeUsed: previousRun.knowledge_used === true,
    webUsed: previousRun.web_used === true,
    toolCallCount: Number(previousRun.tool_call_count || 0),
    responseModel: cleanString(previousRun.response_model, 120),
    provider: cleanString(previousRun.provider, 40),
    artifactStatus: cleanString(previousRun.artifact_status, 80),
    artifactOperation: cleanString(previousRun.artifact_operation, 80),
  } : undefined

  return {
    client,
    conversation,
    priorExecution,
    currentCreatedAt,
    workspaceTitle: cleanString(workspaceResult.data.title, 300),
  }
}

const substantiveModel = (requestedModel: string) => (
  requestedModel === LEGACY_GEMINI_FLASH_LITE_MODEL ? GEMINI_FLASH_LITE_MODEL : requestedModel
)
const orchestrationProvider = (requestedModel: string, openAiKey?: string) => {
  if (requestedModel === 'auto') return openAiKey ? 'openai' as const : 'gemini' as const
  return requestedModel.startsWith('gemini-') ? 'gemini' as const : 'openai' as const
}
const orchestrationModel = (requestedModel: string, provider: 'openai'|'gemini') => {
  if (requestedModel !== 'auto') return substantiveModel(requestedModel)
  return provider === 'openai'
    ? cleanString(Deno.env.get('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL, 80)
    : GEMINI_PRO_MODEL
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const gatewayReceivedAtMs = Date.now()
  const traceId = crypto.randomUUID()
  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let body: ArrayBuffer
  try { body = await req.arrayBuffer() }
  catch { return jsonResponse({ error: 'Request body could not be read.' }, 400) }
  const parsedBody = parseGatewayBody(body)
  const messageId = cleanString(parsedBody?.messageId, 200)
  const requestedModel = cleanString(parsedBody?.model, 80) || 'auto'
  logLatency('ASSISTANT_GATEWAY_REQUEST', { traceId, messageId, requestedModel, gatewayVersion: 'v3' })

  try {
    const fastPath = await tryTrivialFastPath({ authorization, supabaseUrl, anonKey, parsedBody, traceId, gatewayReceivedAtMs })
    if (fastPath) return fastPath
  } catch (fastPathError) {
    console.error('Trivial assistant fast path failed:', errorMessage(fastPathError))
    return jsonResponse({ error: 'Kısa asistan yanıtı tamamlanamadı. Lütfen tekrar deneyin.', code: 'TRIVIAL_FAST_PATH_FAILED' }, 502)
  }
  if (!parsedBody) return jsonResponse({ error: 'Request body is invalid.' }, 400)

  const workspaceId = cleanString(parsedBody.workspaceId, 200)
  const currentMessage = cleanString(parsedBody.message, 32_000)
  if (!workspaceId || !messageId || !currentMessage) {
    return jsonResponse({ error: 'workspaceId, messageId and message are required.' }, 400)
  }

  const openAiApiKey = Deno.env.get('OPENAI_API_KEY') || undefined
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || undefined
  let semanticProvider = orchestrationProvider(requestedModel, openAiApiKey)
  let semanticModel = orchestrationModel(requestedModel, semanticProvider)
  let semanticApiKey = semanticProvider === 'gemini' ? geminiApiKey : openAiApiKey
  if (!semanticApiKey) {
    return jsonResponse({
      error: `${semanticProvider === 'gemini' ? 'GEMINI' : 'OPENAI'} API key is not configured for semantic orchestration.`,
      code: 'SEMANTIC_ORCHESTRATOR_UNAVAILABLE',
    }, 503)
  }

  const semanticStartedAtMs = Date.now()
  let context
  try {
    context = await loadSemanticContext({ authorization, supabaseUrl, anonKey, workspaceId, messageId })
  } catch (contextError) {
    console.error('Semantic context could not be loaded:', errorMessage(contextError))
    return jsonResponse({ error: 'Konuşma bağlamı hazırlanamadı. Lütfen tekrar deneyin.', code: 'SEMANTIC_CONTEXT_UNAVAILABLE' }, 503)
  }
  const attachmentNames = Array.isArray(parsedBody.chatAttachments)
    ? parsedBody.chatAttachments.map((item: any) => cleanString(item?.name, 240)).filter(Boolean)
    : []
  const semanticRequestHash = await sha256Text(JSON.stringify({
    orchestratorVersion: `${SEMANTIC_ORCHESTRATOR_VERSION}-scope-inventory-v1`,
    requestedModel,
    currentMessage,
    messageCreatedAt: context.currentCreatedAt,
    conversation: context.conversation,
    priorExecution: context.priorExecution || null,
    workspaceTitle: context.workspaceTitle,
    attachmentNames,
  }))

  const { data: semanticClaimData, error: semanticClaimError } = await context.client.rpc('claim_assistant_semantic_plan', {
    p_workspace_id: workspaceId,
    p_message_id: messageId,
    p_request_hash: semanticRequestHash,
    p_user_limit_per_minute: USER_REQUESTS_PER_MINUTE,
    p_workspace_limit_per_minute: WORKSPACE_REQUESTS_PER_MINUTE,
  })
  if (semanticClaimError) {
    console.error('Semantic plan claim failed:', semanticClaimError)
    return jsonResponse({ error: 'Semantic orchestration state could not be claimed.', code: 'SEMANTIC_PLAN_STORE_UNAVAILABLE' }, 503)
  }
  const semanticClaim = Array.isArray(semanticClaimData) ? semanticClaimData[0] : semanticClaimData
  const semanticOutcome = cleanString(semanticClaim?.outcome, 40)
  if (semanticOutcome === 'rate_limited') {
    return jsonResponse({ error: 'Çok kısa sürede fazla asistan isteği gönderildi. Lütfen bir dakika sonra tekrar deneyin.', code: 'RATE_LIMITED' }, 429)
  }
  if (semanticOutcome === 'in_progress') {
    return jsonResponse({ error: 'Bu mesaj için semantic plan hâlâ hazırlanıyor.', code: 'SEMANTIC_PLAN_IN_PROGRESS' }, 409)
  }

  let semantic: SemanticOrchestrationResult
  let semanticSource: 'cache' | 'provider' | 'fallback' = 'provider'
  const semanticLeaseToken = cleanString(semanticClaim?.lease_token, 200)

  if (semanticOutcome === 'completed') {
    const cachedPlan = normalizeCachedSemanticPlan({
      value: semanticClaim?.plan,
      currentMessage,
      conversation: context.conversation,
      priorExecution: context.priorExecution,
    })
    if (!cachedPlan) {
      return jsonResponse({ error: 'Cached semantic plan is invalid for the current runtime.', code: 'SEMANTIC_PLAN_INVALID' }, 503)
    }
    semanticProvider = semanticClaim?.provider === 'gemini' ? 'gemini' : 'openai'
    semanticModel = cleanString(semanticClaim?.model, 120) || semanticModel
    semantic = {
      plan: applyConversationScopeInventoryPolicy({ plan: cachedPlan, currentMessage, conversation: context.conversation }),
      usage: semanticClaim?.usage && typeof semanticClaim.usage === 'object'
        ? semanticClaim.usage as Record<string, number>
        : undefined,
      fallbackUsed: false,
      provider: semanticProvider,
      model: semanticModel,
    }
    semanticSource = 'cache'
  } else {
    if (semanticOutcome !== 'claimed' || !semanticLeaseToken) {
      return jsonResponse({ error: 'Semantic orchestration claim returned an invalid state.', code: 'SEMANTIC_PLAN_CLAIM_INVALID' }, 503)
    }

    semantic = await buildSemanticExecutionPlan({
      provider: semanticProvider,
      apiKey: semanticApiKey,
      model: semanticModel,
      message: currentMessage,
      conversation: context.conversation,
      priorExecution: context.priorExecution,
      workspaceTitle: context.workspaceTitle,
      attachmentNames,
    })

    if (
      semantic.fallbackUsed
      && requestedModel === 'auto'
      && semanticProvider === 'openai'
      && geminiApiKey
    ) {
      semanticProvider = 'gemini'
      semanticModel = GEMINI_PRO_MODEL
      semanticApiKey = geminiApiKey
      semantic = await buildSemanticExecutionPlan({
        provider: semanticProvider,
        apiKey: semanticApiKey,
        model: semanticModel,
        message: currentMessage,
        conversation: context.conversation,
        priorExecution: context.priorExecution,
        workspaceTitle: context.workspaceTitle,
        attachmentNames,
      })
    }

    semantic.plan = applyConversationScopeInventoryPolicy({
      plan: semantic.plan,
      currentMessage,
      conversation: context.conversation,
    })

    if (semantic.fallbackUsed) {
      semanticSource = 'fallback'
      const { error: failError } = await context.client.rpc('fail_assistant_semantic_plan', {
        p_workspace_id: workspaceId,
        p_message_id: messageId,
        p_request_hash: semanticRequestHash,
        p_lease_token: semanticLeaseToken,
        p_error_message: 'semantic_provider_fallback',
      })
      if (failError) console.warn('Semantic fallback state could not be marked failed:', failError.message)
    } else {
      const { error: completeError } = await context.client.rpc('complete_assistant_semantic_plan', {
        p_workspace_id: workspaceId,
        p_message_id: messageId,
        p_request_hash: semanticRequestHash,
        p_lease_token: semanticLeaseToken,
        p_plan: semantic.plan,
        p_provider: semantic.provider,
        p_model: semantic.model,
        p_usage: semantic.usage || {},
      })
      if (completeError) {
        console.error('Semantic plan could not be persisted:', completeError)
        return jsonResponse({ error: 'Semantic plan could not be persisted safely.', code: 'SEMANTIC_PLAN_PERSIST_FAILED' }, 503)
      }
    }
  }

  const semanticCompletedAtMs = Date.now()
  const explicitGemini = requestedModel !== 'auto' && requestedModel.startsWith('gemini-')
  if (explicitGemini && semantic.plan.webMode === 'required') {
    return jsonResponse({
      error: 'Gemini seçiliyken JetWork başka bir sağlayıcının web aracına gizlice geçmez. Web araştırması için Otomatik veya OpenAI modelini seçin.',
      code: 'GEMINI_PROVIDER_LOCK_WEB_UNAVAILABLE',
    }, 409)
  }
  if (explicitGemini && semantic.plan.webMode === 'if_internal_insufficient') {
    semantic.plan.webMode = 'none'
  }

  const forwardedModel = substantiveModel(requestedModel)
  const nextBody: AssistantGatewayBody = {
    ...parsedBody,
    model: forwardedModel,
    message: attachSemanticPlan(currentMessage, semantic.plan),
  }
  logLatency('ASSISTANT_SEMANTIC_ORCHESTRATION', {
    traceId,
    messageId,
    requestedModel,
    forwardedModel,
    orchestrationProvider: semantic.provider,
    orchestrationModel: semantic.model,
    orchestratorVersion: `${SEMANTIC_ORCHESTRATOR_VERSION}-scope-inventory-v1`,
    semanticSource,
    intent: semantic.plan.intent,
    executionMode: semantic.plan.executionMode,
    continuation: semantic.plan.conversationState?.continuation === true,
    userMove: semantic.plan.conversationState?.userMove,
    priorIntent: semantic.plan.conversationState?.priorIntent,
    topic: semantic.plan.conversationState?.topic,
    rejectedScopes: semantic.plan.conversationState?.rejectedScopes?.length || 0,
    enumerationTool: semantic.plan.enumerationTarget?.tool,
    enumerationObjectType: semantic.plan.enumerationTarget?.objectType,
    knowledgeRequired: semantic.plan.knowledgeRequired,
    webMode: semantic.plan.webMode,
    fallbackUsed: semantic.fallbackUsed,
    semanticMs: semanticCompletedAtMs - semanticStartedAtMs,
  })

  let upstream: Response
  const upstreamStartedAtMs = Date.now()
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-core-v2`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': 'jetwork-semantic-gateway/v3',
      },
      body: JSON.stringify(nextBody),
    })
  } catch (error) {
    console.error('Semantic gateway could not reach reasoning core:', errorMessage(error))
    return jsonResponse({ error: 'Asistan reasoning servisine bağlanılamadı. Lütfen tekrar deneyin.', code: 'REASONING_CORE_UNREACHABLE' }, 502)
  }
  const coreHeadersAtMs = Date.now()
  logLatency('ASSISTANT_GATEWAY_LATENCY', {
    traceId, messageId, requestedModel, forwardedModel, status: upstream.status,
    semanticMs: semanticCompletedAtMs - semanticStartedAtMs,
    coreHeadersMs: coreHeadersAtMs - upstreamStartedAtMs,
    gatewayToCoreHeadersMs: coreHeadersAtMs - gatewayReceivedAtMs,
  })

  if (!upstream.ok || !upstream.body) {
    const responseBody = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0))
    return new Response(responseBody, {
      status: upstream.status || 502,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'X-JetWork-Stream-Gateway': 'v3',
      },
    })
  }

  const reader = upstream.body.getReader()
  let downstreamCancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sink = createSafeStreamSink(controller)
      const pump = (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) sink.write(value)
          }
        } catch (error) {
          console.error('Semantic gateway upstream read failed:', errorMessage(error))
          if (sink.isOpen()) {
            sink.event('error', { type: 'error', message: 'Asistan yanıt akışı tamamlanamadı. Lütfen tekrar deneyin.' })
            sink.done()
          }
        } finally {
          logLatency('ASSISTANT_GATEWAY_LATENCY_COMPLETE', {
            traceId, messageId, requestedModel, forwardedModel, downstreamCancelled,
            gatewayTotalMs: Date.now() - gatewayReceivedAtMs,
          })
          sink.close()
          try { reader.releaseLock() } catch { /* already released */ }
        }
      })()
      edgeWaitUntil(pump)
    },
    cancel(reason) {
      downstreamCancelled = true
      console.info('Assistant downstream stream cancelled:', String(reason || 'client disconnected'))
    },
  })
  return new Response(stream, { headers: gatewayHeaders })
})
