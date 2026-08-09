import {
  SEMANTIC_PLAN_END,
  SEMANTIC_PLAN_START,
  routeReasoningRequest,
  routingSurfaceFromMessage,
  type ConversationSemanticState,
  type ReasoningExecutionMode,
  type ReasoningIntent,
  type ReasoningPlan,
} from './reasoningEngine.ts'
import type { AssistantProvider } from './modelProviders.ts'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_SEMANTIC_MODEL = 'gemini-3.5-flash'
const SEMANTIC_RETRY_DELAYS_MS = [250, 750] as const
export const SEMANTIC_ORCHESTRATOR_VERSION = 'semantic-orchestrator-v3.1-resilient-agent-loop'
export const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
const AGENT_LOOP_MARKER = '[JETWORK_AGENT_LOOP]'

export interface SemanticContextMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface PriorExecutionContext {
  messageId?: string
  intent?: string
  complexity?: string
  knowledgeUsed?: boolean
  webUsed?: boolean
  toolCallCount?: number
  responseModel?: string
  provider?: string
  artifactStatus?: string
  artifactOperation?: string
}

export interface SemanticOrchestrationResult {
  plan: ReasoningPlan
  usage?: Record<string, number>
  fallbackUsed: boolean
  fallbackReason?: string
  provider: AssistantProvider
  model: string
}

class SemanticProviderError extends Error {
  constructor(
    public readonly provider: AssistantProvider,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SemanticProviderError'
  }
}

const planSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['simple_answer','sap_diagnosis','research','analysis','document','decision','project'] },
    complexity: { type: 'string', enum: ['low','medium','high'] },
    executionMode: { type: 'string', enum: ['direct','knowledge','research','artifact','decision','project'] },
    goal: { type: 'string' },
    knowledgeRequired: { type: 'boolean' },
    webMode: { type: 'string', enum: ['none','required','if_internal_insufficient'] },
    verificationRequired: { type: 'boolean' },
    creativeMode: { type: 'boolean' },
    evidenceQueries: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    steps: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          toolHint: { type: 'string', enum: ['none','knowledge','web','relations','verification','synthesis'] },
          successCriteria: { type: 'string' },
        },
        required: ['id','label','toolHint','successCriteria'],
        additionalProperties: false,
      },
    },
    conversationState: {
      type: 'object',
      properties: {
        continuation: { type: 'boolean' },
        topic: { type: 'string' },
        userMove: { type: 'string', enum: ['new_request','follow_up','correction','rejection','confirmation','clarification','topic_shift'] },
        priorIntent: { type: 'string', enum: ['none','simple_answer','sap_diagnosis','research','analysis','document','decision','project'] },
        rejectedHypotheses: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        retainedContext: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        openQuestions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      },
      required: ['continuation','topic','userMove','priorIntent','rejectedHypotheses','retainedContext','openQuestions'],
      additionalProperties: false,
    },
    orchestratorVersion: { type: 'string' },
  },
  required: [
    'intent','complexity','executionMode','goal','knowledgeRequired','webMode','verificationRequired',
    'creativeMode','evidenceQueries','steps','conversationState','orchestratorVersion',
  ],
  additionalProperties: false,
} as const

const instructions = [
  'You are the JetWork Semantic Orchestrator. You do not answer the user. You choose capabilities and execution policy for the selected answer model.',
  'Understand the CURRENT USER MESSAGE in the context of RECENT CONVERSATION and PRIOR EXECUTION metadata.',
  'Conversation continuity is semantic. Resolve ellipsis, pronouns, corrections, rejections, confirmations and implicit references from context. Never depend on exact keywords, suffixes, regex-like matching or a fixed list of follow-up phrases.',
  'If the current turn continues an unresolved enterprise or technical task, preserve the prior task intent even when the user does not repeat any domain nouns.',
  'If the user corrects or rejects the previous assistant hypothesis during technical diagnosis, preserve diagnosis intent, record the rejected hypothesis, and keep corporate knowledge capability available so the answer model can investigate alternatives.',
  'PRIOR EXECUTION metadata is authoritative about what JetWork actually did on the previous turn. Previous assistant prose is conversational context only and is never evidence.',
  'Corporate technical facts require JetWork knowledge evidence. Set knowledgeRequired=true for internal SAP/CRM/C4C/IS-U/FICA/Billing/Jira/product/process facts, exact technical identifiers, internal business rules, or continuations of such tasks.',
  'Set simple_answer/direct only when the current request is genuinely self-contained and does not continue an unresolved enterprise, technical, document, decision or project task.',
  'Set webMode=required when the current request needs live/current public information or the user explicitly requires external web verification. Set webMode=if_internal_insufficient when public web may be useful only if internal/contextual evidence is insufficient. Otherwise use none.',
  'Choose capabilities, not a rigid research script. Do not prescribe search -> detail -> relations as a mandatory sequence; the answer model will observe tool results and decide its next action inside bounded runtime limits.',
  'Evidence queries and steps are hints only. Keep them compact and do not encode hidden chain-of-thought.',
  'Set document/artifact only when the user is actually asking to create or revise an artifact. Incidental action verbs inside a technical sentence are not document commands.',
  'For design/decision work, use decision mode when alternatives should be evaluated.',
  'Produce a compact execution plan. No hidden chain-of-thought and no final user answer.',
].join('\n')

const cleanText = (value: unknown, max = 4_000) => String(value || '').trim().slice(0, max)

const normalizeFallbackText = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const FALLBACK_REJECTION_PATTERN = /(?:^|\s)(?:hayir|degil|yanlis|reddediyorum|reddettim|no|not|wrong|incorrect)(?:\s|$)/i
const FALLBACK_CORRECTION_PATTERN = /(?:^|\s)(?:aslinda|duzeltiyorum|duzeltme|demek istedigim|correction|actually)(?:\s|$)/i

const fallbackUserMove = (message: string, continuation: boolean): ConversationSemanticState['userMove'] => {
  const normalized = normalizeFallbackText(message)
  if (FALLBACK_REJECTION_PATTERN.test(normalized)) return 'rejection'
  if (FALLBACK_CORRECTION_PATTERN.test(normalized)) return 'correction'
  return continuation ? 'follow_up' : 'new_request'
}

const hypothesisExcerpt = (value: string) => cleanText(value.replace(/\s+/g, ' '), 320)

const collectFallbackRejectedHypotheses = (
  conversation: SemanticContextMessage[],
  currentMessage: string,
): string[] => {
  const rejected: string[] = []
  let candidateAssistant = ''
  for (const item of conversation) {
    if (item.role === 'assistant') {
      candidateAssistant = item.content
      continue
    }
    if (candidateAssistant && fallbackUserMove(item.content, true) === 'rejection') {
      const excerpt = hypothesisExcerpt(candidateAssistant)
      if (excerpt && !rejected.includes(excerpt)) rejected.push(excerpt)
    }
    candidateAssistant = ''
  }
  if (candidateAssistant && fallbackUserMove(currentMessage, true) === 'rejection') {
    const excerpt = hypothesisExcerpt(candidateAssistant)
    if (excerpt && !rejected.includes(excerpt)) rejected.push(excerpt)
  }
  return rejected.slice(-6)
}

const fallbackTopic = (conversation: SemanticContextMessage[], currentMessage: string) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const item = conversation[index]
    if (item.role !== 'user' || !item.content.trim()) continue
    if (fallbackUserMove(item.content, true) === 'rejection') continue
    const route = routeReasoningRequest(item.content)
    if (route.intent !== 'simple_answer' || route.knowledgeRequired || route.webMode !== 'none') {
      return cleanText(item.content, 500)
    }
  }
  return cleanText(currentMessage, 500)
}

const executionModeForIntent = (
  intent: ReasoningIntent,
  knowledgeRequired: boolean,
  webMode: ReasoningPlan['webMode'],
): ReasoningExecutionMode => {
  if (intent === 'document') return 'artifact'
  if (intent === 'decision') return 'decision'
  if (intent === 'project') return 'project'
  if (intent === 'research' || webMode !== 'none') return 'research'
  if (knowledgeRequired || intent === 'sap_diagnosis' || intent === 'analysis') return 'knowledge'
  return 'direct'
}

export const compactSemanticConversation = (messages: SemanticContextMessage[]) => {
  const recent = messages.slice(-10)
  const compact: SemanticContextMessage[] = []
  let characters = 0
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const item = recent[index]
    const content = cleanText(item.content, 2_500)
    if (!content) continue
    if (characters + content.length > 14_000) break
    compact.unshift({ role: item.role, content })
    characters += content.length
  }
  return compact
}

const lastSubstantiveUser = (messages: SemanticContextMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && messages[index].content.trim()) return messages[index].content.trim()
  }
  return ''
}

const lastAssistant = (messages: SemanticContextMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant' && messages[index].content.trim()) return messages[index].content.trim()
  }
  return ''
}

const fallbackPlan = (
  currentMessage: string,
  conversation: SemanticContextMessage[],
  priorExecution?: PriorExecutionContext,
): ReasoningPlan => {
  const previousUser = lastSubstantiveUser(conversation)
  const previousAssistant = lastAssistant(conversation)
  const currentRoute = routeReasoningRequest(currentMessage)
  const priorIntent = String(priorExecution?.intent || 'none') as ReasoningIntent | 'none'
  const validPriorIntent: ReasoningIntent | 'none' = [
    'none','simple_answer','sap_diagnosis','research','analysis','document','decision','project',
  ].includes(priorIntent) ? priorIntent : 'none'
  const activePriorIntent: ReasoningIntent | 'none' = validPriorIntent === 'simple_answer' ? 'none' : validPriorIntent
  const continuation = Boolean(previousUser && activePriorIntent !== 'none')
  const userMove = fallbackUserMove(currentMessage, continuation)
  const preserveKnowledgeTask = continuation && (
    activePriorIntent === 'sap_diagnosis'
    || activePriorIntent === 'analysis'
    || priorExecution?.knowledgeUsed === true
  )
  const intent: ReasoningIntent = preserveKnowledgeTask && activePriorIntent !== 'none'
    ? activePriorIntent
    : currentRoute.intent
  const knowledgeRequired = preserveKnowledgeTask || currentRoute.knowledgeRequired || userMove === 'rejection' || userMove === 'correction'
  const webMode = currentRoute.webMode
  const topic = fallbackTopic(conversation, currentMessage)
  const evidenceQueries = [topic, previousUser, currentMessage].map(item => cleanText(item, 350)).filter(Boolean)
  const rejectedHypotheses = collectFallbackRejectedHypotheses(conversation, currentMessage)
  const retainedContext = conversation
    .slice(-6)
    .map(item => cleanText(`${item.role}: ${item.content}`, 700))
    .filter(Boolean)
  const state: ConversationSemanticState = {
    continuation,
    topic,
    userMove,
    priorIntent: activePriorIntent,
    rejectedHypotheses,
    retainedContext: [
      ...retainedContext,
      ...(previousAssistant && !retainedContext.some(item => item.includes(previousAssistant.slice(0, 80)))
        ? [cleanText(`assistant: ${previousAssistant}`, 700)]
        : []),
    ].slice(-8),
    openQuestions: [],
  }
  return {
    intent,
    complexity: currentRoute.complexity === 'high' || priorExecution?.complexity === 'high' ? 'high' : 'medium',
    executionMode: executionModeForIntent(intent, knowledgeRequired, webMode),
    goal: cleanText(currentMessage, 800) || 'Kullanıcı talebini mevcut konuşma bağlamıyla güvenli biçimde yanıtla.',
    knowledgeRequired,
    webMode,
    verificationRequired: knowledgeRequired || currentRoute.verificationRequired,
    creativeMode: currentRoute.creativeMode,
    evidenceQueries: [...new Set(evidenceQueries)].slice(0, 3),
    steps: [
      { id: 'evidence-internal', label: 'Kurumsal bağlamı ve ilgili kanıtı ara', toolHint: 'knowledge', successCriteria: 'Yanıt için kurumsal kanıt bulunur veya eksik olduğu doğrulanır.' },
      { id: 'verify', label: 'Kanıt yeterliliğini doğrula', toolHint: 'verification', successCriteria: 'Kanıt ve belirsizlik ayrıştırılır.' },
      { id: 'synthesize', label: 'Bağlama uygun yanıtı üret', toolHint: 'synthesis', successCriteria: 'Yanıt önceki konuşmayla tutarlı ve kanıta dayalıdır.' },
    ],
    conversationState: state,
    orchestratorVersion: `${SEMANTIC_ORCHESTRATOR_VERSION}-safe-fallback`,
  }
}

const normalizePlan = (value: ReasoningPlan, fallback: ReasoningPlan): ReasoningPlan => {
  const intents: ReasoningIntent[] = ['simple_answer','sap_diagnosis','research','analysis','document','decision','project']
  const modes: ReasoningExecutionMode[] = ['direct','knowledge','research','artifact','decision','project']
  const intent = intents.includes(value.intent) ? value.intent : fallback.intent
  const executionMode = value.executionMode && modes.includes(value.executionMode) ? value.executionMode : fallback.executionMode
  const evidenceQueries = [...new Set((value.evidenceQueries || []).map(query => cleanText(query, 400)).filter(Boolean))].slice(0, 5)
  const state = value.conversationState && typeof value.conversationState === 'object'
    ? value.conversationState
    : fallback.conversationState
  const plan: ReasoningPlan = {
    ...fallback,
    ...value,
    intent,
    executionMode,
    goal: cleanText(value.goal, 1_000) || fallback.goal,
    evidenceQueries,
    steps: Array.isArray(value.steps) ? value.steps.slice(0, 8) : fallback.steps,
    conversationState: state,
    orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
  }
  if (plan.knowledgeRequired && !plan.evidenceQueries.length) {
    plan.evidenceQueries = fallback.evidenceQueries.length ? fallback.evidenceQueries : [fallback.goal.slice(0, 300)]
  }
  if (
    plan.intent === 'sap_diagnosis'
    || plan.conversationState?.userMove === 'rejection'
    || plan.conversationState?.userMove === 'correction'
  ) {
    plan.knowledgeRequired = true
    plan.verificationRequired = true
    if (plan.complexity === 'low') plan.complexity = 'medium'
  }
  if (plan.conversationState?.continuation && plan.conversationState.priorIntent === 'sap_diagnosis') {
    plan.intent = 'sap_diagnosis'
    plan.executionMode = 'knowledge'
    plan.knowledgeRequired = true
    plan.verificationRequired = true
    if (plan.complexity === 'low') plan.complexity = 'medium'
  }
  return plan
}

const hasAgentLoopDirective = (goal: string) => goal.includes(AGENT_LOOP_MARKER)

export const applyAgentLoopPolicy = (
  inputPlan: ReasoningPlan,
  provider: AssistantProvider,
): ReasoningPlan => {
  const plan: ReasoningPlan = {
    ...inputPlan,
    evidenceQueries: [...(inputPlan.evidenceQueries || [])],
    steps: [...(inputPlan.steps || [])],
    conversationState: inputPlan.conversationState
      ? { ...inputPlan.conversationState }
      : inputPlan.conversationState,
    orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
  }

  const needsEvidenceCapability = plan.knowledgeRequired || plan.webMode !== 'none'
  if (!needsEvidenceCapability || plan.executionMode === 'artifact' || plan.intent === 'document') return plan

  const requestedWebMode = plan.webMode
  const providerNativeWeb = provider === 'gemini' && requestedWebMode !== 'none'
  const requiredWeb = requestedWebMode === 'required'
  const capabilityRules: string[] = []

  if (plan.knowledgeRequired) {
    capabilityRules.push('Kurumsal/teknik bir iddiayı kesinleştirmeden önce JetWork knowledge araçlarıyla kanıt ara.')
  }
  if (requiredWeb) {
    capabilityRules.push('Kullanıcı güncel/dış doğrulama istediği için nihai yanıttan önce izin verilen web aracını kullan; ilk sonuç zayıfsa sorguyu değiştirip yeniden ara.')
  } else if (requestedWebMode === 'if_internal_insufficient') {
    capabilityRules.push('İç kanıt yetersiz, güncellik gerektiren veya dış doğrulama gereken noktada web aracına geçebilirsin.')
  }
  if (plan.conversationState?.rejectedHypotheses?.length) {
    capabilityRules.push(`Kullanıcının reddettiği önceki hipotezler: ${plan.conversationState.rejectedHypotheses.map(item => cleanText(item, 220)).join(' | ')}. Yeni ve açık kanıt olmadan bunları tekrar aday gibi sunma.`)
  }
  if (providerNativeWeb) {
    capabilityRules.push(`${PROVIDER_WEB_CAPABILITY_MARKER} Public web araştırması için yalnız seçili Gemini sağlayıcısının native Google Search aracını kullan; OpenAI web aracına geçme.`)
    plan.knowledgeRequired = true
    plan.webMode = 'none'
  }

  const adaptiveDirective = [
    AGENT_LOOP_MARKER,
    'Araştırma sırasını önceden sabitleme. Mevcut araçlardan amaca uygun olanı seç, sonucu gözlemle ve kanıt yeterliyse dur.',
    'Sonuç zayıf, belirsiz veya çelişkiliyse sorguyu yeniden formüle et, başka kayıt/detay/ilişkiyi incele veya izin verilen başka capabilityye geç.',
    'Aynı başarısız çağrıyı anlamsızca tekrarlama. Kullanıcının reddettiği hipotezi yeni kanıt olmadan tekrar gerçek gibi sunma.',
    'Araç bütçesi biterse kanıt açığını açıkça belirt; boşluğu kendi bilginden uydurma.',
    ...capabilityRules,
  ].join(' ')

  if (!hasAgentLoopDirective(plan.goal)) {
    plan.goal = `${cleanText(plan.goal, 1_000)}\n\n${adaptiveDirective}`.trim()
  }

  plan.evidenceQueries = []
  plan.verificationRequired = false
  if (provider === 'openai' && requiredWeb) plan.webMode = 'if_internal_insufficient'
  plan.steps = [
    {
      id: 'adaptive-evidence-loop',
      label: 'Kanıt ihtiyacını değerlendir ve araçları adaptif kullan',
      toolHint: plan.knowledgeRequired ? 'knowledge' : (requestedWebMode !== 'none' ? 'web' : 'none'),
      successCriteria: 'Model her araç sonucunu gözlemleyip yeterli kanıta ulaşana veya güvenli bütçe sınırına gelene kadar bir sonraki aksiyonu seçer.',
    },
    {
      id: 'synthesize',
      label: 'Toplanan kanıtlarla yanıtı sentezle',
      toolHint: 'synthesis',
      successCriteria: 'Doğrulanmış bilgi, çıkarım ve açık kanıt eksikleri ayrıştırılır.',
    },
  ]

  return plan
}

export const normalizeCachedSemanticPlan = (input: {
  value: unknown
  currentMessage: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ReasoningPlan | null => {
  if (!input.value || typeof input.value !== 'object') return null
  try {
    const current = routingSurfaceFromMessage(input.currentMessage).current || input.currentMessage.trim()
    const fallback = fallbackPlan(current, compactSemanticConversation(input.conversation), input.priorExecution)
    const normalized = normalizePlan(input.value as ReasoningPlan, fallback)
    const provider: AssistantProvider = normalized.goal.includes(PROVIDER_WEB_CAPABILITY_MARKER) ? 'gemini' : 'openai'
    const adapted = applyAgentLoopPolicy(normalized, provider)
    if (String(normalized.orchestratorVersion || '').includes('safe-fallback')) {
      adapted.orchestratorVersion = normalized.orchestratorVersion
    }
    return adapted
  } catch {
    return null
  }
}

const openAiText = (payload: Record<string, unknown>) => {
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : []
  return output.flatMap(item => {
    if (item.type !== 'message' || !Array.isArray(item.content)) return []
    return (item.content as Array<Record<string, unknown>>)
      .filter(part => part.type === 'output_text' && typeof part.text === 'string')
      .map(part => String(part.text))
  }).join('').trim()
}

const geminiText = (payload: Record<string, unknown>) => {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates as Array<Record<string, unknown>> : []
  const content = candidates[0]?.content
  const parts = content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts)
    ? (content as Record<string, unknown>).parts as Array<Record<string, unknown>>
    : []
  return parts.filter(part => part.thought !== true && typeof part.text === 'string').map(part => String(part.text)).join('').trim()
}

const retryableSemanticStatus = (status: number) => [429, 500, 502, 503, 504].includes(status)

const semanticFailureCode = (error: unknown) => {
  if (error instanceof SemanticProviderError) {
    const detail = normalizeFallbackText(error.message)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36)
    return `http-${error.status}${detail ? `-${detail}` : ''}`
  }
  const message = error instanceof Error ? error.message : String(error || '')
  if (/abort|timeout/i.test(message)) return 'timeout'
  if (/json|schema|structured/i.test(message)) return 'schema'
  return 'provider-error'
}

const delayWithAbort = async (milliseconds: number, signal?: AbortSignal) => {
  if (milliseconds <= 0) return
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => finish(signal?.reason || new DOMException('Aborted', 'AbortError'))
    const timeout = setTimeout(() => finish(), milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function withSemanticRetry<T>(
  provider: AssistantProvider,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= SEMANTIC_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
      const retryable = error instanceof SemanticProviderError
        ? retryableSemanticStatus(error.status)
        : /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(error instanceof Error ? error.message : String(error))
      if (!retryable || attempt >= SEMANTIC_RETRY_DELAYS_MS.length) throw error
      const delayMs = SEMANTIC_RETRY_DELAYS_MS[attempt]
      console.warn(`Semantic orchestrator ${provider} request failed transiently; retrying`, {
        attempt: attempt + 1,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      })
      await delayWithAbort(delayMs, signal)
    }
  }
  throw lastError
}

async function requestOpenAiPlan(input: { apiKey: string; model: string; payload: Record<string, unknown>; signal?: AbortSignal }) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST', signal: input.signal,
    headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      instructions,
      input: JSON.stringify(input.payload),
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'jetwork_semantic_execution_plan', strict: true, schema: planSchema } },
      max_output_tokens: 2_400,
      store: false,
    }),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const detail = (body.error as Record<string, unknown> | undefined)?.message
    throw new SemanticProviderError('openai', response.status, String(detail || `OpenAI semantic orchestration failed with ${response.status}.`))
  }
  const text = openAiText(body)
  if (!text) throw new Error('OpenAI semantic orchestration returned no structured text.')
  return {
    plan: JSON.parse(text) as ReasoningPlan,
    usage: body.usage && typeof body.usage === 'object' ? body.usage as Record<string, number> : undefined,
  }
}

const geminiGenerationConfig = (compatibilityMode: boolean) => compatibilityMode
  ? {
      maxOutputTokens: 2_400,
      responseMimeType: 'application/json',
    }
  : {
      maxOutputTokens: 2_400,
      thinkingConfig: { thinkingLevel: 'low' },
      responseFormat: {
        text: {
          mimeType: 'application/json',
          schema: planSchema,
        },
      },
    }

async function requestGeminiPlanOnce(input: {
  apiKey: string
  model: string
  payload: Record<string, unknown>
  compatibilityMode: boolean
  signal?: AbortSignal
}) {
  const response = await fetch(`${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`, {
    method: 'POST', signal: input.signal,
    headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input.payload) }] }],
      generationConfig: geminiGenerationConfig(input.compatibilityMode),
    }),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const detail = (body.error as Record<string, unknown> | undefined)?.message
    throw new SemanticProviderError('gemini', response.status, String(detail || `Gemini semantic orchestration failed with ${response.status}.`))
  }
  const text = geminiText(body)
  if (!text) throw new Error('Gemini semantic orchestration returned no structured text.')
  const metadata = body.usageMetadata && typeof body.usageMetadata === 'object'
    ? body.usageMetadata as Record<string, unknown>
    : {}
  return {
    plan: JSON.parse(text) as ReasoningPlan,
    usage: {
      input_tokens: Number(metadata.promptTokenCount || 0),
      output_tokens: Number(metadata.candidatesTokenCount || 0),
      reasoning_tokens: Number(metadata.thoughtsTokenCount || 0),
      total_tokens: Number(metadata.totalTokenCount || 0),
    },
  }
}

async function requestGeminiPlan(input: { apiKey: string; model: string; payload: Record<string, unknown>; signal?: AbortSignal }) {
  try {
    return await requestGeminiPlanOnce({ ...input, compatibilityMode: false })
  } catch (error) {
    if (!(error instanceof SemanticProviderError) || error.status !== 400 || input.signal?.aborted) throw error
    console.warn('Gemini semantic structured schema request returned HTTP 400; retrying in JSON compatibility mode.', {
      model: input.model,
      error: error.message.slice(0, 500),
    })
    return requestGeminiPlanOnce({ ...input, compatibilityMode: true })
  }
}

const resilientFallbackResult = (input: {
  fallback: ReasoningPlan
  provider: AssistantProvider
  model: string
  reason: string
}): SemanticOrchestrationResult => {
  const plan = applyAgentLoopPolicy(input.fallback, input.provider)
  plan.orchestratorVersion = `${SEMANTIC_ORCHESTRATOR_VERSION}-safe-fallback-${input.reason}`.slice(0, 80)
  return {
    plan,
    fallbackUsed: true,
    fallbackReason: input.reason,
    provider: input.provider,
    model: input.model,
  }
}

export async function buildSemanticExecutionPlan(input: {
  provider: AssistantProvider
  apiKey?: string
  model: string
  message: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
  workspaceTitle?: string
  attachmentNames?: string[]
  signal?: AbortSignal
}): Promise<SemanticOrchestrationResult> {
  const currentMessage = routingSurfaceFromMessage(input.message).current || input.message.trim()
  const conversation = compactSemanticConversation(input.conversation)
  const fallback = fallbackPlan(currentMessage, conversation, input.priorExecution)
  const semanticModel = input.provider === 'gemini' ? GEMINI_SEMANTIC_MODEL : input.model
  if (!input.apiKey) {
    return resilientFallbackResult({
      fallback,
      provider: input.provider,
      model: semanticModel,
      reason: 'missing-api-key',
    })
  }
  const payload = {
    currentUserMessage: currentMessage,
    recentConversation: conversation,
    priorExecution: input.priorExecution || null,
    workspaceTitle: cleanText(input.workspaceTitle, 300),
    attachmentNames: (input.attachmentNames || []).map(name => cleanText(name, 240)).filter(Boolean).slice(0, 3),
  }
  try {
    const result = input.provider === 'gemini'
      ? await withSemanticRetry('gemini', () => requestGeminiPlan({ apiKey: input.apiKey!, model: semanticModel, payload, signal: input.signal }), input.signal)
      : await withSemanticRetry('openai', () => requestOpenAiPlan({ apiKey: input.apiKey!, model: semanticModel, payload, signal: input.signal }), input.signal)
    const normalized = normalizePlan(result.plan, fallback)
    return {
      plan: applyAgentLoopPolicy(normalized, input.provider),
      usage: result.usage,
      fallbackUsed: false,
      provider: input.provider,
      model: semanticModel,
    }
  } catch (error) {
    const reason = semanticFailureCode(error)
    console.warn('Semantic orchestrator failed; resilient agentic fallback will be used:', {
      provider: input.provider,
      model: semanticModel,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
    return resilientFallbackResult({
      fallback,
      provider: input.provider,
      model: semanticModel,
      reason,
    })
  }
}

export const attachSemanticPlan = (message: string, plan: ReasoningPlan) => [
  message.trim(),
  '',
  SEMANTIC_PLAN_START,
  JSON.stringify(plan),
  SEMANTIC_PLAN_END,
].join('\n')