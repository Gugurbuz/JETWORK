import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool,
  type AssistantSourceRef,
} from '../_shared/assistantTools.ts'
import {
  cleanProviderItemsForOpenAi,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  OPENAI_MODELS,
  providerForModel,
  requestGeminiResponse,
  type AssistantProvider,
} from '../_shared/modelProviders.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-5.6-sol'
const AUTO_MODEL = 'auto'
const ALLOWED_MODELS = new Set([
  AUTO_MODEL,
  ...OPENAI_MODELS,
  ...GEMINI_MODELS,
])
const MAX_HISTORY_CHARACTERS = 36_000
const MAX_CHAT_ATTACHMENTS = 3
const MAX_CHAT_ATTACHMENT_CHARACTERS = 60_000

const boundedIntegerEnv = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(Deno.env.get(name))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(Math.trunc(parsed), maximum))
}

const MAX_TOOL_ROUNDS = boundedIntegerEnv('ASSISTANT_MAX_TOOL_ROUNDS', 4, 1, 8)
const MAX_TOOL_CALLS = boundedIntegerEnv('ASSISTANT_MAX_TOOL_CALLS', 8, 1, 24)
const TOOL_TIMEOUT_MS = boundedIntegerEnv('ASSISTANT_TOOL_TIMEOUT_MS', 12_000, 1_000, 30_000)
const RUN_TIMEOUT_MS = boundedIntegerEnv('ASSISTANT_RUN_TIMEOUT_MS', 120_000, 15_000, 150_000)
const MAX_OUTPUT_TOKENS = boundedIntegerEnv('ASSISTANT_MAX_OUTPUT_TOKENS', 12_000, 512, 24_000)
const USER_REQUESTS_PER_MINUTE = boundedIntegerEnv(
  'ASSISTANT_USER_REQUESTS_PER_MINUTE',
  6,
  1,
  60,
)
const WORKSPACE_REQUESTS_PER_MINUTE = boundedIntegerEnv(
  'ASSISTANT_WORKSPACE_REQUESTS_PER_MINUTE',
  30,
  1,
  240,
)

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

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : 'Unexpected assistant runtime error.'
)

const userFacingAssistantError = (error: unknown) => {
  const detail = errorMessage(error)
  if (/no credits remaining|insufficient_quota|billing/i.test(detail)) {
    return 'OpenAI API kullanım kredisi tükendi. Yönetici hesaba bakiye ekledikten sonra tekrar deneyin.'
  }
  if (/resource_exhausted|quota exceeded|gemini.*quota/i.test(detail)) {
    return 'Gemini API kullanım kotası tükendi. Yönetici kotayı yeniledikten sonra tekrar deneyin.'
  }
  return 'Asistan yanıtı tamamlanamadı. Lütfen tekrar deneyin.'
}

const cleanString = (value: unknown, maxLength: number) =>
  String(value ?? '').trim().slice(0, maxLength)

const sha256Text = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const uniqueSources = (sources: AssistantSourceRef[]) => {
  const seen = new Set<string>()
  return sources.filter(source => {
    const key = [
      source.sourceId || '',
      source.canonicalKey || '',
      source.sourceName,
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function resolveKnowledgeWorkspace(client: any, workspaceId: string) {
  const { data, error } = await client.rpc('resolve_account_knowledge_workspace', {
    p_workspace_id: workspaceId,
  })
  if (error) throw error
  if (typeof data !== 'string' || !data) {
    throw new Error('Account knowledge workspace could not be resolved.')
  }
  return data
}

async function loadActivePrompt(client: any, workspaceId: string) {
  const { data, error } = await client.rpc('get_active_assistant_prompt', {
    p_workspace_id: workspaceId,
  })
  if (error) throw error
  const prompt = Array.isArray(data) ? data[0] : data
  if (!prompt) throw new Error('No active assistant prompt is configured.')
  return prompt
}

async function getOrCreateConversation(
  client: any,
  workspaceId: string,
  ownerId: string,
  promptVersionId: string,
  model: string,
) {
  const { data: existing, error: selectError } = await client
    .from('assistant_conversations')
    .select('id,workspace_id,owner_id,prompt_version_id,model,status,state_items,revision')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selectError) throw selectError
  if (
    existing?.prompt_version_id === promptVersionId
    && existing?.model === model
  ) return existing
  if (existing) {
    const { error: archiveError } = await client
      .from('assistant_conversations')
      .update({
        status: 'archived',
        locked_turn_id: null,
        lock_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (archiveError) throw archiveError
  }

  const { data: created, error: insertError } = await client
    .from('assistant_conversations')
    .insert({
      workspace_id: workspaceId,
      owner_id: ownerId,
      prompt_version_id: promptVersionId,
      model,
      status: 'active',
    })
    .select('id,workspace_id,owner_id,prompt_version_id,model,status,state_items,revision')
    .single()
  if (!insertError && created) return created

  // A simultaneous first request may have created the single active
  // workspace conversation after our initial read.
  const { data: raced, error: racedError } = await client
    .from('assistant_conversations')
    .select('id,workspace_id,owner_id,prompt_version_id,model,status,state_items,revision')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .eq('prompt_version_id', promptVersionId)
    .maybeSingle()
  if (racedError || !raced) {
    throw insertError || racedError || new Error('Assistant conversation could not be created.')
  }
  return raced
}

async function loadConversationHistory(
  client: any,
  workspaceId: string,
  currentMessageId: string,
) {
  let query = client
    .from('messages')
    .select('id,role,text,created_at')
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'model'])
    .order('created_at', { ascending: false })
    .limit(24)
  if (currentMessageId) query = query.neq('id', currentMessageId)

  const { data, error } = await query
  if (error) throw error

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let characterCount = 0
  for (const row of [...(data || [])].reverse()) {
    const content = cleanString(row.text, 9_000)
    if (!content) continue
    if (characterCount + content.length > MAX_HISTORY_CHARACTERS) {
      while (history.length && characterCount + content.length > MAX_HISTORY_CHARACTERS) {
        const removed = history.shift()
        characterCount -= removed?.content.length || 0
      }
    }
    history.push({
      role: row.role === 'user' ? 'user' : 'assistant',
      content,
    })
    characterCount += content.length
  }
  return history
}

function compactConversationState(items: Array<Record<string, unknown>>) {
  let state = [...items]
  const exceedsBudget = () => (
    state.length > 160
    || JSON.stringify(state).length > 450_000
  )

  while (exceedsBudget()) {
    const nextUserIndex = state.findIndex((item, index) => (
      index > 0 && item.role === 'user'
    ))
    if (nextUserIndex <= 0) break
    state = state.slice(nextUserIndex)
  }
  return state
}

interface OpenAiResponse {
  id?: string
  status?: string
  model?: string
  output?: Array<Record<string, unknown>>
  usage?: Record<string, number>
  error?: { message?: string }
  incomplete_details?: { reason?: string }
}

interface OpenAiStreamEvent {
  type?: string
  delta?: string
  response?: OpenAiResponse
  error?: { message?: string }
  message?: string
}

const addUsage = (
  accumulated: Record<string, number> | undefined,
  next: Record<string, number> | undefined,
) => {
  if (!next) return accumulated
  const merged = { ...(accumulated || {}) }
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      merged[key] = (merged[key] || 0) + value
    }
  }
  return merged
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: number | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function parseSseFrames(
  buffer: string,
  flush = false,
): { events: OpenAiStreamEvent[]; remainder: string } {
  const events: OpenAiStreamEvent[] = []
  let cursor = 0
  const separator = /\r?\n\r?\n/g
  let match: RegExpExecArray | null

  while ((match = separator.exec(buffer)) !== null) {
    const frame = buffer.slice(cursor, match.index)
    const data = frame
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data && data !== '[DONE]') {
      try {
        events.push(JSON.parse(data))
      } catch {
        throw new Error('OpenAI returned a malformed streaming event.')
      }
    }
    cursor = match.index + match[0].length
  }

  let remainder = buffer.slice(cursor)
  if (flush && remainder.trim()) {
    const data = remainder
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data && data !== '[DONE]') {
      try {
        events.push(JSON.parse(data))
      } catch {
        throw new Error('OpenAI returned a malformed final streaming event.')
      }
    }
    remainder = ''
  }

  return { events, remainder }
}

async function requestOpenAiResponse(
  apiKey: string,
  body: Record<string, unknown>,
  onTextDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<OpenAiResponse> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, stream: true }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const detail = cleanString(payload?.error?.message, 1_000)
    throw new Error(detail || `OpenAI Responses API returned ${response.status}.`)
  }
  if (!response.body) throw new Error('OpenAI Responses API returned an empty stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed: OpenAiResponse | null = null

  const handleEvent = (event: OpenAiStreamEvent) => {
    if (
      (event.type === 'response.output_text.delta'
        || event.type === 'response.refusal.delta')
      && event.delta
    ) {
      onTextDelta(event.delta)
      return
    }
    if (event.type === 'response.completed' && event.response) {
      completed = event.response
      return
    }
    if (
      event.type === 'error'
      || event.type === 'response.failed'
      || event.type === 'response.incomplete'
    ) {
      const incompleteReason = cleanString(
        event.response?.incomplete_details?.reason,
        300,
      )
      throw new Error(
        cleanString(event.error?.message || event.message || event.response?.error?.message, 1_000)
        || (
          incompleteReason
            ? `OpenAI response generation was incomplete: ${incompleteReason}.`
            : 'OpenAI response generation failed.'
        ),
      )
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseFrames(buffer)
    buffer = parsed.remainder
    parsed.events.forEach(handleEvent)
  }
  buffer += decoder.decode()
  parseSseFrames(buffer, true).events.forEach(handleEvent)

  if (!completed) throw new Error('OpenAI stream ended before response.completed.')
  if (completed.status && completed.status !== 'completed') {
    throw new Error(completed.error?.message || `OpenAI response status is ${completed.status}.`)
  }
  return completed
}

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  payload: unknown,
) {
  controller.enqueue(encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
  ))
}

const assistantStreamResponse = (stream: ReadableStream<Uint8Array>) => new Response(
  stream,
  {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  },
)

function cachedAssistantResponse(input: {
  text: string
  sources: AssistantSourceRef[]
  conversationId: string
  model?: string
  usage?: Record<string, number>
}) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sendEvent(controller, encoder, 'status', {
        type: 'status',
        stage: 'answering',
        label: 'Kayıtlı yanıt getiriliyor...',
      })
      sendEvent(controller, encoder, 'text_delta', {
        type: 'text_delta',
        delta: input.text,
      })
      sendEvent(controller, encoder, 'sources', {
        type: 'sources',
        sources: input.sources,
      })
      sendEvent(controller, encoder, 'completed', {
        type: 'completed',
        conversationId: input.conversationId,
        model: input.model,
        usage: input.usage,
        cached: true,
      })
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return assistantStreamResponse(stream)
}

async function logToolRun(
  client: any,
  input: {
    conversationId: string
    turnId: string
    workspaceId: string
    ownerId: string
    promptVersionId: string
    toolName: string
    callId: string
    arguments: Record<string, unknown>
    resultSummary: Record<string, unknown>
    sourceRefs: AssistantSourceRef[]
    status: 'completed' | 'failed'
    durationMs: number
    errorMessage?: string
  },
) {
  const { error } = await client
    .from('assistant_tool_runs')
    .insert({
      conversation_id: input.conversationId,
      turn_id: input.turnId,
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      prompt_version_id: input.promptVersionId,
      tool_name: input.toolName,
      call_id: input.callId,
      arguments: input.arguments,
      result_summary: input.resultSummary,
      source_refs: input.sourceRefs,
      status: input.status,
      duration_ms: input.durationMs,
      error_message: input.errorMessage?.slice(0, 2_000),
    })
  if (error) throw error
}

serve(async req => {
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
  const openAiApiKey = Deno.env.get('OPENAI_API_KEY')
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Authentication is required.' }, 401)
  }
  if (!serviceRoleKey) {
    return jsonResponse({ error: 'Assistant server configuration is incomplete.' }, 500)
  }
  if (!openAiApiKey && !geminiApiKey) {
    return jsonResponse({
      error: 'No assistant provider is configured. OPENAI_API_KEY or GEMINI_API_KEY is required.',
      code: 'RUNTIME_DISABLED',
    }, 503)
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > 256_000) {
    return jsonResponse({ error: 'Request payload is too large.' }, 413)
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let claimedTurnId: string | null = null
  let claimedConversationId: string | null = null
  let claimedLeaseToken: string | null = null

  try {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData.user) {
      return jsonResponse({ error: 'A valid user session is required.' }, 401)
    }
    if (authData.user.is_anonymous) {
      return jsonResponse({ error: 'Corporate assistant access requires a permanent user account.' }, 403)
    }

    const body = await req.json()
    const workspaceId = cleanString(body?.workspaceId, 200)
    const messageId = cleanString(body?.messageId, 200)
    const message = cleanString(body?.message, 32_000)
    const requestedModel = cleanString(body?.model || AUTO_MODEL, 80)
    const chatAttachments: Array<{
      name: string
      mimeType: string
      content: string
    }> = []
    let remainingAttachmentCharacters = MAX_CHAT_ATTACHMENT_CHARACTERS
    if (Array.isArray(body?.chatAttachments)) {
      for (const candidate of body.chatAttachments.slice(0, MAX_CHAT_ATTACHMENTS)) {
        if (!candidate || typeof candidate !== 'object' || remainingAttachmentCharacters <= 0) {
          continue
        }
        const content = cleanString(
          candidate.content,
          remainingAttachmentCharacters,
        )
        if (!content) continue
        chatAttachments.push({
          name: cleanString(candidate.name || 'chat-attachment.txt', 240),
          mimeType: cleanString(candidate.mimeType || 'text/plain', 120),
          content,
        })
        remainingAttachmentCharacters -= content.length
      }
    }
    if (!workspaceId || !messageId || (!message && !chatAttachments.length)) {
      return jsonResponse({
        error: 'workspaceId, messageId and a message or chat attachment are required.',
      }, 400)
    }
    if (!ALLOWED_MODELS.has(requestedModel)) {
      return jsonResponse({ error: 'Requested assistant model is not allowed.' }, 400)
    }

    const { data: workspace, error: workspaceError } = await client
      .from('workspaces')
      .select('id,title')
      .eq('id', workspaceId)
      .maybeSingle()
    if (workspaceError || !workspace) {
      return jsonResponse({ error: 'Workspace access denied.' }, 403)
    }

    const knowledgeWorkspaceId = await resolveKnowledgeWorkspace(client, workspaceId)

    const prompt = await loadActivePrompt(adminClient, workspaceId)
    const promptModelCandidate = cleanString(
      Deno.env.get('OPENAI_MODEL') || prompt.model || DEFAULT_MODEL,
      80,
    )
    const promptModel = OPENAI_MODELS.has(promptModelCandidate)
      ? promptModelCandidate
      : DEFAULT_MODEL
    const configuredModel = requestedModel === AUTO_MODEL
      ? (openAiApiKey ? promptModel : DEFAULT_GEMINI_MODEL)
      : requestedModel
    const configuredProvider = providerForModel(configuredModel)
    if (configuredProvider === 'openai' && !openAiApiKey) {
      return jsonResponse({ error: 'OPENAI_API_KEY is not configured for the selected model.' }, 503)
    }
    if (configuredProvider === 'gemini' && !geminiApiKey) {
      return jsonResponse({ error: 'GEMINI_API_KEY is not configured for the selected model.' }, 503)
    }

    const conversation = await getOrCreateConversation(
      adminClient,
      workspaceId,
      authData.user.id,
      prompt.id,
      configuredModel,
    )
    const currentUserContent = [
      message,
      ...chatAttachments.map((attachment, index) => [
        '',
        `[UNTRUSTED_CHAT_ATTACHMENT_${index + 1}]`,
        JSON.stringify({
          name: attachment.name,
          mimeType: attachment.mimeType,
        }),
        attachment.content,
        `[END_UNTRUSTED_CHAT_ATTACHMENT_${index + 1}]`,
      ].join('\n')),
    ].filter(Boolean).join('\n')
    const requestHash = await sha256Text(stableJson({
      message,
      chatAttachments,
      requestedModel,
    }))
    const safetyIdentifier = await sha256Text(
      `jetwork:${workspaceId}:${authData.user.id}`,
    )
    const { data: claimData, error: claimError } = await adminClient.rpc(
      'claim_assistant_turn',
      {
        p_conversation_id: conversation.id,
        p_workspace_id: workspaceId,
        p_owner_id: authData.user.id,
        p_prompt_version_id: prompt.id,
        p_message_id: messageId,
        p_request_hash: requestHash,
        p_user_limit_per_minute: USER_REQUESTS_PER_MINUTE,
        p_workspace_limit_per_minute: WORKSPACE_REQUESTS_PER_MINUTE,
      },
    )
    if (claimError) throw claimError
    const claim = Array.isArray(claimData) ? claimData[0] : claimData
    if (!claim) throw new Error('Assistant turn could not be claimed.')
    if (claim.outcome === 'rate_limited') {
      return jsonResponse({
        error: 'Çok kısa sürede fazla asistan isteği gönderildi. Lütfen bir dakika sonra tekrar deneyin.',
        code: 'RATE_LIMITED',
      }, 429)
    }
    if (claim.outcome === 'busy' || claim.outcome === 'in_progress') {
      return jsonResponse({
        error: 'Bu çalışma alanında başka bir yanıt hâlâ hazırlanıyor. Tamamlandıktan sonra tekrar deneyin.',
        code: 'CONVERSATION_BUSY',
      }, 409)
    }
    if (claim.outcome === 'completed') {
      return cachedAssistantResponse({
        text: cleanString(claim.response_text, 200_000),
        sources: Array.isArray(claim.source_refs) ? claim.source_refs : [],
        conversationId: conversation.id,
        model: claim.response_model || configuredModel,
        usage: claim.usage && typeof claim.usage === 'object' ? claim.usage : undefined,
      })
    }
    const turnId = cleanString(claim.turn_id, 200)
    const leaseToken = cleanString(claim.lease_token, 200)
    if (claim.outcome !== 'claimed' || !turnId || !leaseToken) {
      throw new Error('Assistant turn claim returned an invalid result.')
    }
    claimedTurnId = turnId
    claimedConversationId = conversation.id
    claimedLeaseToken = leaseToken

    const { data: lockedConversation, error: lockedConversationError } = await adminClient
      .from('assistant_conversations')
      .select('id,state_items,revision')
      .eq('id', conversation.id)
      .single()
    if (lockedConversationError || !lockedConversation) {
      throw lockedConversationError || new Error('Assistant conversation could not be loaded.')
    }
    const persistedState = Array.isArray(lockedConversation.state_items)
      ? lockedConversation.state_items as Array<Record<string, unknown>>
      : []
    const conversationRevision = Number(lockedConversation.revision || 0)
    const history = persistedState.length
      ? []
      : await loadConversationHistory(client, workspaceId, messageId)
    const inputItems: Array<Record<string, unknown>> = [
      ...(persistedState.length ? persistedState : history),
      { role: 'user', content: currentUserContent },
    ]

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let sources: AssistantSourceRef[] = []
        let totalToolCalls = 0
        let usage: Record<string, number> | undefined
        let responseModel = configuredModel
        let activeModel = configuredModel
        let activeProvider: AssistantProvider = configuredProvider
        const toolResultCache = new Map<string, Awaited<ReturnType<typeof executeAssistantTool>>>()
        let turnCompleted = false
        const runController = new AbortController()
        const abortRun = () => runController.abort(req.signal.reason)
        if (req.signal.aborted) abortRun()
        else req.signal.addEventListener('abort', abortRun, { once: true })
        const runTimeout = setTimeout(
          () => runController.abort(
            new DOMException('Assistant run timed out.', 'TimeoutError'),
          ),
          RUN_TIMEOUT_MS,
        )

        try {
          sendEvent(controller, encoder, 'status', {
            type: 'status',
            stage: 'thinking',
            label: 'Talep değerlendiriliyor...',
          })

          for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
            const mustSynthesizeAnswer = round === MAX_TOOL_ROUNDS
            let roundText = ''
            const finalInstruction = mustSynthesizeAnswer
              ? 'Araç araştırması tamamlandı. Artık yeni araç çağrısı yapmadan, mevcut sonuçlardan kullanıcıya doğrudan ve dürüst bir nihai yanıt üret. Kaynaklarda kesin karşılık yoksa bunu açıkça belirt; hata verme.'
              : ''
            const requestActiveProvider = async () => {
              if (activeProvider === 'gemini') {
                return await requestGeminiResponse({
                  apiKey: String(geminiApiKey),
                  model: activeModel,
                  instructions: [prompt.prompt_text, finalInstruction].filter(Boolean).join('\n\n'),
                  items: inputItems,
                  tools: ASSISTANT_KNOWLEDGE_TOOLS as unknown as ReadonlyArray<Record<string, unknown>>,
                  allowTools: !mustSynthesizeAnswer,
                  maxOutputTokens: MAX_OUTPUT_TOKENS,
                  onText: delta => {
                    roundText += delta
                  },
                  signal: runController.signal,
                })
              }

              return await requestOpenAiResponse(
                String(openAiApiKey),
                {
                  model: activeModel,
                  instructions: prompt.prompt_text,
                  input: mustSynthesizeAnswer
                    ? [
                        ...cleanProviderItemsForOpenAi(inputItems),
                        { role: 'developer', content: finalInstruction },
                      ]
                    : cleanProviderItemsForOpenAi(inputItems),
                  tools: ASSISTANT_KNOWLEDGE_TOOLS,
                  tool_choice: mustSynthesizeAnswer ? 'none' : 'auto',
                  parallel_tool_calls: false,
                  reasoning: { effort: 'medium' },
                  text: { verbosity: 'medium' },
                  max_output_tokens: MAX_OUTPUT_TOKENS,
                  safety_identifier: safetyIdentifier,
                  store: false,
                },
                delta => {
                  roundText += delta
                },
                runController.signal,
              )
            }

            let response: OpenAiResponse
            try {
              response = await requestActiveProvider()
            } catch (providerError) {
              if (
                requestedModel !== AUTO_MODEL
                || activeProvider !== 'openai'
                || !geminiApiKey
                || runController.signal.aborted
              ) throw providerError

              console.warn('OpenAI provider failed; switching this turn to Gemini:', errorMessage(providerError))
              activeProvider = 'gemini'
              activeModel = DEFAULT_GEMINI_MODEL
              roundText = ''
              sendEvent(controller, encoder, 'status', {
                type: 'status',
                stage: 'thinking',
                label: 'Yedek yapay zeka sağlayıcısına geçiliyor...',
              })
              response = await requestActiveProvider()
            }

            usage = addUsage(usage, response.usage)
            responseModel = response.model || responseModel
            const output = response.output || []
            const toolCalls = output.filter(item => item.type === 'function_call')
            if (!toolCalls.length) {
              if (!roundText.trim()) {
                throw new Error(`${activeProvider} completed without a user-visible answer.`)
              }
              inputItems.push(...output)
              const stateItems = compactConversationState(inputItems)
              const { error: completionError } = await adminClient.rpc(
                'complete_assistant_turn',
                {
                  p_turn_id: turnId,
                  p_conversation_id: conversation.id,
                  p_lease_token: leaseToken,
                  p_expected_revision: conversationRevision,
                  p_state_items: stateItems,
                  p_response_text: roundText,
                  p_source_refs: sources,
                  p_usage: usage || {},
                  p_response_model: responseModel,
                },
              )
              if (completionError) throw completionError
              turnCompleted = true

              sendEvent(controller, encoder, 'status', {
                type: 'status',
                stage: 'answering',
                label: 'Yanıt hazırlanıyor...',
              })
              sendEvent(controller, encoder, 'text_delta', {
                type: 'text_delta',
                delta: roundText,
              })
              sendEvent(controller, encoder, 'sources', {
                type: 'sources',
                sources,
              })
              sendEvent(controller, encoder, 'completed', {
                type: 'completed',
                  conversationId: conversation.id,
                  model: responseModel,
                  usage,
                  cached: false,
                })
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            }

            totalToolCalls += toolCalls.length
            if (totalToolCalls > MAX_TOOL_CALLS) {
              throw new Error('Assistant exceeded the safe tool-call limit.')
            }

            inputItems.push(...output)
            sendEvent(controller, encoder, 'status', {
              type: 'status',
              stage: 'searching_knowledge',
              label: 'Kurumsal bilgi bankasında aranıyor...',
            })

            for (const call of toolCalls) {
              const toolName = cleanString(call.name, 120)
              const callId = cleanString(call.call_id, 200)
              const startedAt = performance.now()
              let parsedArguments: Record<string, unknown> = {}
              try {
                parsedArguments = JSON.parse(String(call.arguments || '{}'))
                const cacheKey = `${toolName}:${stableJson(parsedArguments)}`
                const cachedResult = toolResultCache.get(cacheKey)
                const result = cachedResult || await withTimeout(
                  executeAssistantTool(
                    client,
                    knowledgeWorkspaceId,
                    toolName,
                    parsedArguments,
                  ),
                  TOOL_TIMEOUT_MS,
                  toolName,
                )
                if (!cachedResult) toolResultCache.set(cacheKey, result)
                await logToolRun(adminClient, {
                  conversationId: conversation.id,
                  turnId,
                  workspaceId,
                  ownerId: authData.user.id,
                  promptVersionId: prompt.id,
                  toolName,
                  callId,
                  arguments: parsedArguments,
                  resultSummary: {
                    ...result.summary,
                    cached: !!cachedResult,
                    knowledgeWorkspaceId,
                  },
                  sourceRefs: result.sources,
                  status: 'completed',
                  durationMs: Math.round(performance.now() - startedAt),
                })
                sources = uniqueSources([...sources, ...result.sources])
                inputItems.push({
                  type: 'function_call_output',
                  call_id: callId,
                  output: result.output,
                })
              } catch (toolError) {
                const detail = errorMessage(toolError)
                inputItems.push({
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({
                    error: 'TOOL_EXECUTION_FAILED',
                    message: detail.slice(0, 1_000),
                  }),
                })
                await logToolRun(adminClient, {
                  conversationId: conversation.id,
                  turnId,
                  workspaceId,
                  ownerId: authData.user.id,
                  promptVersionId: prompt.id,
                  toolName,
                  callId,
                  arguments: parsedArguments,
                  resultSummary: {},
                  sourceRefs: [],
                  status: 'failed',
                  durationMs: Math.round(performance.now() - startedAt),
                  errorMessage: detail,
                })
              }
            }

            sendEvent(controller, encoder, 'sources', {
              type: 'sources',
              sources,
            })
          }

          throw new Error('Assistant could not produce a final answer after knowledge retrieval.')
        } catch (streamError) {
          console.error('OpenAI assistant stream failed:', streamError)
          if (!turnCompleted) {
            const { error: failError } = await adminClient.rpc(
              'fail_assistant_turn',
              {
                p_turn_id: turnId,
                p_conversation_id: conversation.id,
                p_lease_token: leaseToken,
                p_error_message: errorMessage(streamError),
              },
            )
            if (failError) console.error('Assistant turn failure could not be persisted:', failError)
          }
          try {
            sendEvent(controller, encoder, 'error', {
              type: 'error',
              message: userFacingAssistantError(streamError),
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {
            // The caller disconnected; the turn status above remains authoritative.
          }
        } finally {
          clearTimeout(runTimeout)
          req.signal.removeEventListener('abort', abortRun)
        }
      },
    })

    claimedTurnId = null
    claimedConversationId = null
    claimedLeaseToken = null
    return assistantStreamResponse(stream)
  } catch (error) {
    console.error('OpenAI assistant request failed:', error)
    if (claimedTurnId && claimedConversationId && claimedLeaseToken) {
      const { error: failError } = await adminClient.rpc(
        'fail_assistant_turn',
        {
          p_turn_id: claimedTurnId,
          p_conversation_id: claimedConversationId,
          p_lease_token: claimedLeaseToken,
          p_error_message: errorMessage(error),
        },
      )
      if (failError) console.error('Assistant pre-stream failure could not be persisted:', failError)
    }
    return jsonResponse({
      error: 'Asistan isteği başlatılamadı. Lütfen tekrar deneyin.',
      code: 'ASSISTANT_REQUEST_FAILED',
    }, 500)
  }
})
