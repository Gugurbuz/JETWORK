import {
  SEMANTIC_PLAN_END,
  SEMANTIC_PLAN_START,
  routeReasoningRequest,
  routingSurfaceFromMessage,
  type AssistantPromptProfile,
  type ConversationSemanticState,
  type ReasoningExecutionMode,
  type ReasoningIntent,
  type ReasoningPlan,
} from './reasoningEngine.ts'
import type { AssistantProvider } from './modelProviders.ts'
import type { AssistantActiveOperation } from './operationState.ts'

export const SEMANTIC_ORCHESTRATOR_VERSION = 'primary-llm-agent-v1'
export const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'

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
  resolvedRequest?: string
  activeEntities?: string[]
  requestedEvidence?: string[]
  verifiedFactRefs?: string[]
  activeOperation?: AssistantActiveOperation
}

export interface SemanticOrchestrationResult {
  plan: ReasoningPlan
  usage?: Record<string, number>
  fallbackUsed: boolean
  fallbackReason?: string
  provider: AssistantProvider
  model: string
}

const cleanText = (value: unknown, max = 4_000) => String(value ?? '').trim().slice(0, max)
const unique = (values: string[], limit = 12) => [...new Set(values.map(value => cleanText(value, 500)).filter(Boolean))].slice(0, limit)
const normalize = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const compactSemanticConversation = (messages: SemanticContextMessage[]) => {
  const recent = messages.slice(-8)
  const compact: SemanticContextMessage[] = []
  let characters = 0
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const item = recent[index]
    const max = item.role === 'assistant' ? 900 : 1_600
    const content = cleanText(item.content, max)
    if (!content) continue
    if (characters + content.length > 8_000) break
    compact.unshift({ role: item.role, content })
    characters += content.length
  }
  return compact
}

const TECHNICAL_ENTITY_PATTERN = /\b(?:Z[A-Z0-9_]{2,}(?:[-_/][A-Z0-9_]+)*|CHECK_[A-Z0-9_]+|NINJA_[A-Z0-9_]+|[A-Z][A-Z0-9_]{2,}-\d{2,4})\b/g
const REJECTION_PATTERN = /(?:^|\s)(?:hayir|degil|yanlis|reddediyorum|reddettim|no|not|wrong|incorrect)(?:\s|$)/i
const CORRECTION_PATTERN = /(?:^|\s)(?:aslinda|duzeltiyorum|duzeltme|demek istedigim|correction|actually)(?:\s|$)/i
const CONFIRMATION_PATTERN = /^(?:evet|aynen|dogru|tamam|ok|okay|yes|correct)$/i
const CONTINUATION_PATTERN = /\b(?:devam|devamini|sonraki|kalan|gerisi|digerleri|more|rest|continue|next)\b/i
const ELLIPTICAL_PATTERN = /^(?:tam kod ver|kodu ver|hata mesaji nedir|mesaj nedir|onu goster|peki|neden|nasil|hangileri|hangi mesajlari)\b/i

const extractTechnicalEntities = (value: string) => unique([...value.toLocaleUpperCase('en-US').matchAll(TECHNICAL_ENTITY_PATTERN)].map(match => match[0]), 10)

const priorUserEntities = (conversation: SemanticContextMessage[]) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role !== 'user') continue
    const entities = extractTechnicalEntities(conversation[index].content)
    if (entities.length) return entities
  }
  return []
}

const requestedEvidenceFor = (message: string) => {
  const text = normalize(message)
  const requested: string[] = []
  if (text.includes('mesaj') || /\b(?:message|hata metni|message text)\b/.test(text)) requested.push('message_text')
  if (/\b(?:kod|code|source|kaynak kod|abap)\b/.test(text)) requested.push('abap_source')
  if (/\b(?:ne demek|nedir|anlami|acilimi|what is|meaning)\b/.test(text)) requested.push('definition')
  if (/\b(?:kural|rule|kosul|condition|tetik|trigger)\b/.test(text)) requested.push('trigger_rule')
  return unique(requested, 8)
}

const priorIntentFor = (priorExecution?: PriorExecutionContext): ReasoningIntent | 'none' => {
  const value = String(priorExecution?.intent || 'none') as ReasoningIntent | 'none'
  return ['none','simple_answer','sap_diagnosis','research','analysis','document','decision','project'].includes(value) ? value : 'none'
}

const userMoveFor = (message: string, continuation: boolean): ConversationSemanticState['userMove'] => {
  const text = normalize(message)
  if (REJECTION_PATTERN.test(text)) return 'rejection'
  if (CORRECTION_PATTERN.test(text)) return 'correction'
  if (CONFIRMATION_PATTERN.test(text)) return 'confirmation'
  if (continuation) return 'follow_up'
  return 'new_request'
}

const collectRejectedHypotheses = (conversation: SemanticContextMessage[], currentMessage: string) => {
  const rejected: string[] = []
  const all = [...conversation, { role: 'user' as const, content: currentMessage }]
  for (let index = 0; index < all.length; index += 1) {
    const item = all[index]
    if (item.role !== 'user' || !REJECTION_PATTERN.test(normalize(item.content))) continue
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      if (all[prior].role !== 'assistant') continue
      const assistantText = cleanText(all[prior].content.replace(/\s+/g, ' '), 320)
      if (assistantText) rejected.push(assistantText)
      break
    }
  }
  return unique(rejected, 6)
}

const executionModeFor = (intent: ReasoningIntent): ReasoningExecutionMode => {
  if (intent === 'document') return 'artifact'
  if (intent === 'decision') return 'decision'
  if (intent === 'project') return 'project'
  return 'direct'
}

const promptProfileFor = (intent: ReasoningIntent, executionMode: ReasoningExecutionMode): AssistantPromptProfile => {
  if (executionMode === 'artifact') return 'artifact'
  if (intent === 'document') return 'document'
  return 'base'
}

const buildConversationState = (input: {
  currentMessage: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ConversationSemanticState => {
  const priorIntent = priorIntentFor(input.priorExecution)
  const currentEntities = extractTechnicalEntities(input.currentMessage)
  const priorEntities = unique([
    ...(input.priorExecution?.activeEntities || []),
    ...(input.priorExecution?.verifiedFactRefs || []),
    ...priorUserEntities(input.conversation),
  ], 10)
  const shortFollowUp = normalize(input.currentMessage).split(' ').filter(Boolean).length <= 6
    && ELLIPTICAL_PATTERN.test(normalize(input.currentMessage))
  const operationContinuation = Boolean(input.priorExecution?.activeOperation?.complete === false)
    && CONTINUATION_PATTERN.test(normalize(input.currentMessage))
  const continuation = Boolean((shortFollowUp && priorEntities.length) || operationContinuation)
  const activeEntities = unique([
    ...currentEntities,
    ...(continuation ? priorEntities : []),
  ], 10)
  const resolvedRequest = continuation && activeEntities.length
    ? `${activeEntities.join(', ')} — ${cleanText(input.currentMessage, 700)}`
    : cleanText(input.currentMessage, 900)
  const retainedContext = input.conversation
    .slice(-4)
    .map(item => cleanText(`${item.role}: ${item.content.replace(/\s+/g, ' ')}`, 420))
    .filter(Boolean)

  return {
    continuation,
    topic: activeEntities[0] || cleanText(input.currentMessage, 300),
    userMove: userMoveFor(input.currentMessage, continuation),
    operationMove: operationContinuation ? 'continue' : 'none',
    priorIntent: priorIntent === 'simple_answer' ? 'none' : priorIntent,
    rejectedHypotheses: collectRejectedHypotheses(input.conversation, input.currentMessage),
    rejectedScopes: [],
    retainedContext,
    openQuestions: [],
    resolvedRequest,
    activeEntities,
    requestedEvidence: requestedEvidenceFor(input.currentMessage),
    userDecisions: [],
    verifiedFactRefs: unique(input.priorExecution?.verifiedFactRefs || [], 12),
  }
}

const buildPrimaryAgentPlan = (input: {
  message: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ReasoningPlan => {
  const currentMessage = routingSurfaceFromMessage(input.message).current || input.message.trim()
  const route = routeReasoningRequest(currentMessage)
  const state = buildConversationState({
    currentMessage,
    conversation: input.conversation,
    priorExecution: input.priorExecution,
  })
  const executionMode = executionModeFor(route.intent)
  return {
    intent: route.intent,
    complexity: route.complexity,
    executionMode,
    goal: state.resolvedRequest || currentMessage,
    // Compatibility envelope: the core currently uses knowledgeRequired/webMode to
    // expose tools. In primary-agent mode these flags mean "capability available",
    // not "preflight retrieval required". evidenceQueries stays empty so no RAG runs
    // before the primary model asks for it.
    knowledgeRequired: true,
    enterpriseGroundingRequired: false,
    webMode: 'if_internal_insufficient',
    verificationRequired: false,
    creativeMode: route.creativeMode,
    evidenceQueries: [],
    promptProfile: promptProfileFor(route.intent, executionMode),
    steps: [{
      id: 'primary-agent-loop',
      label: 'Primary LLM kullanıcı talebini yorumlar ve gerekirse capability çağırır',
      toolHint: 'synthesis',
      successCriteria: 'Tool seçimi planner tarafından zorlanmaz; primary LLM ihtiyaç halinde knowledge/web capability kullanır.',
    }],
    conversationState: state,
    orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
  }
}

const mergeCachedConversationState = (
  fresh: ConversationSemanticState | undefined,
  cached: ReasoningPlan['conversationState'],
): ConversationSemanticState | undefined => {
  if (!fresh) return cached
  if (!cached) return fresh
  return {
    ...fresh,
    rejectedHypotheses: unique([...(fresh.rejectedHypotheses || []), ...(cached.rejectedHypotheses || [])], 6),
    rejectedScopes: unique([...(fresh.rejectedScopes || []), ...(cached.rejectedScopes || [])], 6),
    verifiedFactRefs: unique([...(fresh.verifiedFactRefs || []), ...(cached.verifiedFactRefs || [])], 12),
  }
}

export const applyAgentLoopPolicy = (inputPlan: ReasoningPlan, provider: AssistantProvider): ReasoningPlan => {
  const primaryAgent = String(inputPlan.orchestratorVersion || '').includes('primary-llm-agent')
  if (primaryAgent) {
    return {
      ...inputPlan,
      evidenceQueries: [],
      verificationRequired: false,
      enterpriseGroundingRequired: false,
      webMode: 'if_internal_insufficient',
      steps: [{
        id: 'primary-agent-loop',
        label: 'Primary LLM kullanıcı talebini yorumlar ve gerekirse capability çağırır',
        toolHint: 'synthesis',
        successCriteria: 'Kaynak ve web kullanımı primary LLM kararına bağlıdır; boş kaynak sonucu cevap vermeyi engellemez.',
      }],
      orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
    }
  }

  const plan: ReasoningPlan = {
    ...inputPlan,
    evidenceQueries: [...(inputPlan.evidenceQueries || [])],
    steps: [...(inputPlan.steps || [])],
    conversationState: inputPlan.conversationState ? { ...inputPlan.conversationState } : inputPlan.conversationState,
    orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
  }
  if (provider === 'openai' && plan.webMode === 'required') plan.webMode = 'if_internal_insufficient'
  if (provider === 'gemini' && plan.webMode === 'required') {
    plan.webMode = 'none'
    plan.knowledgeRequired = true
    if (!plan.goal.includes(PROVIDER_WEB_CAPABILITY_MARKER)) {
      plan.goal = `${plan.goal}\n${PROVIDER_WEB_CAPABILITY_MARKER}`.trim()
    }
  }
  plan.steps = [
    {
      id: 'adaptive-evidence-loop',
      label: 'Çözümlenmiş talep için en uygun kanıt capabilitysini kullan',
      toolHint: plan.knowledgeRequired ? 'knowledge' : (plan.webMode !== 'none' ? 'web' : 'none'),
      successCriteria: 'Sadece talebi gerçekten destekleyen kanıt tutulur; zayıf adaylar citation sayılmaz.',
    },
    {
      id: 'synthesize',
      label: plan.enterpriseGroundingRequired ? 'Doğrulanmış kanıtlarla yanıtı sentezle' : 'Kanıt varsa kullanarak yanıtı sentezle',
      toolHint: 'synthesis',
      successCriteria: plan.enterpriseGroundingRequired
        ? 'Yanıt yalnız doğrulanmış enterprise fact sınırları içinde üretilir.'
        : 'Kaynak yoksa doğrulanmamış kurum özeli uydurmadan genel reasoning ile yanıtlanır.',
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
  try {
    const fresh = buildPrimaryAgentPlan({
      message: input.currentMessage,
      conversation: input.conversation,
      priorExecution: input.priorExecution,
    })
    const cached = input.value && typeof input.value === 'object' ? input.value as ReasoningPlan : null
    if (cached?.conversationState) {
      fresh.conversationState = mergeCachedConversationState(fresh.conversationState, cached.conversationState)
    }
    return fresh
  } catch {
    return null
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
  const plan = applyAgentLoopPolicy(buildPrimaryAgentPlan({
    message: input.message,
    conversation: compactSemanticConversation(input.conversation),
    priorExecution: input.priorExecution,
  }), input.provider)
  return {
    plan,
    usage: {
      primary_llm_agent_mode: 1,
      semantic_planner_provider_calls_avoided: 1,
    },
    fallbackUsed: false,
    provider: input.provider,
    model: input.model,
  }
}

export const attachSemanticPlan = (message: string, plan: ReasoningPlan) => [
  message.trim(),
  '',
  SEMANTIC_PLAN_START,
  JSON.stringify(plan),
  SEMANTIC_PLAN_END,
].join('\n')
