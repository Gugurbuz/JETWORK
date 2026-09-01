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
import { extractExactTechnicalIdentifiers } from './technicalIdentifier.ts'
import type { AssistantActiveOperation } from './operationState.ts'
import type { ProjectMemoryContextItem } from './projectMemoryContext.ts'

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
  projectMemory?: ProjectMemoryContextItem[]
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

const REJECTION_PATTERN = /(?:^|\s)(?:hayir|degil|yanlis|reddediyorum|reddettim|no|not|wrong|incorrect)(?:\s|$)/i
const CORRECTION_PATTERN = /(?:^|\s)(?:aslinda|duzeltiyorum|duzeltme|demek istedigim|correction|actually)(?:\s|$)/i
const CONFIRMATION_PATTERN = /^(?:evet|aynen|dogru|tamam|ok|okay|yes|correct)$/i
const CONTINUATION_PATTERN = /\b(?:devam|devamini|sonraki|kalan|gerisi|digerleri|more|rest|continue|next)\b/i
const DEEP_RESEARCH_FOLLOW_UP_PATTERN = /(?:bu yaniti|bu cevabi).*(?:daha derin|web|arastir)|(?:daha derin arastir|web uzerinde de arastir)/i
const ELLIPTICAL_PATTERN = /^(?:tam kod ver|kodu ver|hata mesaji nedir|mesaj nedir|onu goster|peki|neden|nasil|hangileri|hangi mesajlari)\b/i
const STRUCTURED_REQUIREMENT_NUMBER_PATTERN = /^\s*\d+(?:\.\d+){1,}\s+/gmu
const STRUCTURED_REQUIREMENT_LANGUAGE_PATTERN = /\b(?:gereksinim[a-z]*|is kurali|servis[a-z]* guncellen[a-z]*|guncellenmelidir|olacaktir|donmelidir|yapilmalidir|mevcutta|proje ile|senaryo)\b/gu

const looksLikeUserProvidedRequirements = (message: string): boolean => {
  const numberedItems = message.match(STRUCTURED_REQUIREMENT_NUMBER_PATTERN)?.length || 0
  const requirementSignals = normalize(message).match(STRUCTURED_REQUIREMENT_LANGUAGE_PATTERN)?.length || 0
  return message.trim().length >= 350 && (numberedItems >= 2 || requirementSignals >= 3)
}

const extractTechnicalEntities = (value: string) => unique(extractExactTechnicalIdentifiers(value, 10), 10)

const priorUserEntities = (conversation: SemanticContextMessage[]) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role !== 'user') continue
    const entities = extractTechnicalEntities(conversation[index].content)
    if (entities.length) return entities
  }
  return []
}

const priorUserRequest = (conversation: SemanticContextMessage[]) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role !== 'user') continue
    const content = cleanText(conversation[index].content, 1_200)
    if (!content || DEEP_RESEARCH_FOLLOW_UP_PATTERN.test(normalize(content))) continue
    return content
  }
  return ''
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

const projectMemoryDecisionContext = (items: ProjectMemoryContextItem[]) => unique(
  items
    .filter(item => ['decision','constraint','requirement','preference','business_rule'].includes(item.category))
    .map(item => `${item.key}: ${item.value}`),
  8,
)

const projectMemoryOpenQuestions = (items: ProjectMemoryContextItem[]) => unique(
  items
    .filter(item => item.category === 'open_question')
    .map(item => `${item.key}: ${item.value}`),
  8,
)

const buildConversationState = (input: {
  currentMessage: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ConversationSemanticState => {
  const priorIntent = priorIntentFor(input.priorExecution)
  const currentNormalized = normalize(input.currentMessage)
  const priorResolvedRequest = cleanText(input.priorExecution?.resolvedRequest, 1_400)
  const currentEntities = extractTechnicalEntities(input.currentMessage)
  const priorEntities = unique([
    ...(input.priorExecution?.activeEntities || []),
    ...(input.priorExecution?.verifiedFactRefs || []),
    ...priorUserEntities(input.conversation),
  ], 10)
  const currentWordCount = currentNormalized.split(' ').filter(Boolean).length
  const shortFollowUp = currentWordCount <= 8 && ELLIPTICAL_PATTERN.test(currentNormalized)
  const genericContinuation = Boolean(priorResolvedRequest)
    && currentWordCount <= 10
    && (
      shortFollowUp
      || CONTINUATION_PATTERN.test(currentNormalized)
      || CONFIRMATION_PATTERN.test(currentNormalized)
      || REJECTION_PATTERN.test(currentNormalized)
      || CORRECTION_PATTERN.test(currentNormalized)
    )
  const operationContinuation = Boolean(input.priorExecution?.activeOperation?.complete === false)
    && CONTINUATION_PATTERN.test(currentNormalized)
  const deepResearchFollowUp = DEEP_RESEARCH_FOLLOW_UP_PATTERN.test(currentNormalized)
  const deepResearchTarget = deepResearchFollowUp ? priorUserRequest(input.conversation) : ''
  const continuation = Boolean(
    genericContinuation
    || (shortFollowUp && priorEntities.length)
    || operationContinuation
    || deepResearchTarget,
  )
  const activeEntities = unique([
    ...currentEntities,
    ...(continuation ? priorEntities : []),
  ], 10)
  const resolvedRequest = deepResearchTarget
    ? `${deepResearchTarget}\nAraştırma talebi: ${cleanText(input.currentMessage, 700)}`
    : genericContinuation && priorResolvedRequest
      ? `${priorResolvedRequest}\nKullanıcının yeni hamlesi: ${cleanText(input.currentMessage, 700)}`
      : continuation && activeEntities.length
        ? `${activeEntities.join(', ')} — ${cleanText(input.currentMessage, 700)}`
        : cleanText(input.currentMessage, 900)
  const retainedContext = [
    ...(genericContinuation && priorResolvedRequest
      ? [`resolved_task: ${cleanText(priorResolvedRequest.replace(/\s+/g, ' '), 600)}`]
      : []),
    ...input.conversation
      .slice(-4)
      .map(item => cleanText(`${item.role}: ${item.content.replace(/\s+/g, ' ')}`, 420))
      .filter(Boolean),
  ].slice(-5)
  const projectMemory = input.priorExecution?.projectMemory || []

  return {
    continuation,
    topic: activeEntities[0]
      || (genericContinuation && priorResolvedRequest ? cleanText(priorResolvedRequest, 300) : cleanText(input.currentMessage, 300)),
    userMove: userMoveFor(input.currentMessage, continuation),
    operationMove: operationContinuation ? 'continue' : 'none',
    priorIntent: priorIntent === 'simple_answer' ? 'none' : priorIntent,
    rejectedHypotheses: collectRejectedHypotheses(input.conversation, input.currentMessage),
    rejectedScopes: [],
    retainedContext,
    openQuestions: projectMemoryOpenQuestions(projectMemory),
    resolvedRequest,
    activeEntities,
    requestedEvidence: unique([
      ...requestedEvidenceFor(input.currentMessage),
      ...(continuation ? input.priorExecution?.requestedEvidence || [] : []),
    ], 8),
    userDecisions: projectMemoryDecisionContext(projectMemory),
    verifiedFactRefs: unique(input.priorExecution?.verifiedFactRefs || [], 12),
  }
}

const buildPrimaryAgentPlan = (input: {
  message: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ReasoningPlan => {
  const currentMessage = routingSurfaceFromMessage(input.message).current || input.message.trim()
  const deepResearchTarget = DEEP_RESEARCH_FOLLOW_UP_PATTERN.test(normalize(currentMessage))
    ? priorUserRequest(input.conversation)
    : ''
  const routed = routeReasoningRequest(deepResearchTarget ? `${deepResearchTarget}\n${currentMessage}` : currentMessage)
  const userProvidedRequirements = looksLikeUserProvidedRequirements(currentMessage)
  const deepResearchNeedsKnowledge = Boolean(deepResearchTarget && extractTechnicalEntities(deepResearchTarget).length)
  const route = userProvidedRequirements
    ? {
        ...routed,
        intent: 'analysis' as const,
        knowledgeRequired: true,
        webMode: 'none' as const,
        verificationRequired: false,
        creativeMode: false,
      }
    : deepResearchNeedsKnowledge
      ? { ...routed, knowledgeRequired: true }
      : routed
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
    // The user's supplied requirement/specification text is itself the primary
    // evidence for analysis. Otherwise respect the deterministic router instead
    // of forcing every primary-agent turn into knowledge + public web mode.
    knowledgeRequired: userProvidedRequirements ? true : route.knowledgeRequired,
    enterpriseGroundingRequired: userProvidedRequirements,
    webMode: userProvidedRequirements ? 'none' : route.webMode,
    verificationRequired: false,
    creativeMode: route.creativeMode,
    evidenceQueries: [],
    promptProfile: promptProfileFor(route.intent, executionMode),
    steps: [{
      id: 'primary-agent-loop',
      label: 'Primary LLM kullanıcı talebini yorumlar ve gerekirse capability çağırır',
      toolHint: 'synthesis',
      successCriteria: userProvidedRequirements
        ? 'Kullanıcı gereksinimleri talep kanıtıdır; mevcut sistem, benzer ürün, sistem sahipliği ve entegrasyon iddiaları için kurumsal knowledge kanıtı kullanılır.'
        : 'Tool seçimi planner tarafından zorlanmaz; primary LLM ihtiyaç halinde knowledge/web capability kullanır.',
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
    retainedContext: unique([...(cached.retainedContext || []), ...(fresh.retainedContext || [])], 8),
    openQuestions: unique([...(cached.openQuestions || []), ...(fresh.openQuestions || [])], 8),
    userDecisions: unique([...(cached.userDecisions || []), ...(fresh.userDecisions || [])], 8),
    activeEntities: unique([...(fresh.activeEntities || []), ...(cached.activeEntities || [])], 10),
    requestedEvidence: unique([...(fresh.requestedEvidence || []), ...(cached.requestedEvidence || [])], 8),
    verifiedFactRefs: unique([...(fresh.verifiedFactRefs || []), ...(cached.verifiedFactRefs || [])], 12),
  }
}

export const applyAgentLoopPolicy = (inputPlan: ReasoningPlan, provider: AssistantProvider): ReasoningPlan => {
  const primaryAgent = String(inputPlan.orchestratorVersion || '').includes('primary-llm-agent')
  if (primaryAgent) {
    const providerNativeWeb = provider === 'gemini' && inputPlan.webMode !== 'none'
    const goal = providerNativeWeb && !inputPlan.goal.includes(PROVIDER_WEB_CAPABILITY_MARKER)
      ? `${inputPlan.goal}\n${PROVIDER_WEB_CAPABILITY_MARKER}`.trim()
      : inputPlan.goal
    return {
      ...inputPlan,
      goal,
      evidenceQueries: [],
      verificationRequired: false,
      enterpriseGroundingRequired: inputPlan.enterpriseGroundingRequired === true,
      // Gemini keeps provider lock by encoding public web as a native capability
      // marker. The core must not interpret this as an OpenAI preflight request.
      webMode: providerNativeWeb ? 'none' : inputPlan.webMode,
      steps: [{
        id: 'primary-agent-loop',
        label: 'Primary LLM kullanıcı talebini yorumlar ve gerekirse capability çağırır',
        toolHint: 'synthesis',
        successCriteria: inputPlan.knowledgeRequired || inputPlan.webMode !== 'none'
          ? 'Kaynak ve web kullanımı primary LLM kararına bağlıdır; boş kaynak sonucu cevap vermeyi engellemez.'
          : 'Kullanıcının verdiği bilgi doğrudan analiz edilir; gereksiz kaynak araması yapılmaz.',
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