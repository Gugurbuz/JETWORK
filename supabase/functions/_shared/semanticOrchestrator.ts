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
import { GEMINI_SEMANTIC_MODEL, usageWithGeminiEstimatedCost } from './geminiCostGuard.ts'
import type { AssistantActiveOperation } from './operationState.ts'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const SEMANTIC_RETRY_DELAYS_MS = [250] as const
export const SEMANTIC_ORCHESTRATOR_VERSION = 'semantic-orchestrator-v3.4-active-operation'
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
    promptProfile: { type: 'string', enum: ['base','knowledge','research','document','artifact'] },
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
        operationMove: { type: 'string', enum: ['none','continue','refine','abandon'] },
        priorIntent: { type: 'string', enum: ['none','simple_answer','sap_diagnosis','research','analysis','document','decision','project'] },
        rejectedHypotheses: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        retainedContext: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        openQuestions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        resolvedRequest: { type: 'string' },
        activeEntities: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        requestedEvidence: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        userDecisions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        verifiedFactRefs: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      },
      required: [
        'continuation','topic','userMove','operationMove','priorIntent','rejectedHypotheses','retainedContext','openQuestions',
        'resolvedRequest','activeEntities','requestedEvidence','userDecisions','verifiedFactRefs',
      ],
      additionalProperties: false,
    },
    orchestratorVersion: { type: 'string' },
  },
  required: [
    'intent','complexity','executionMode','goal','knowledgeRequired','webMode','verificationRequired',
    'creativeMode','evidenceQueries','promptProfile','steps','conversationState','orchestratorVersion',
  ],
  additionalProperties: false,
} as const

const instructions = [
  'You are the JetWork Semantic Orchestrator. You do not answer the user; you resolve the task and choose capabilities.',
  'Resolve the CURRENT USER MESSAGE using RECENT CONVERSATION and PRIOR EXECUTION metadata.',
  'PRIOR EXECUTION may contain activeOperation. This is authoritative runtime state from a previously started operation, not assistant prose.',
  'Classify conversationState.operationMove by meaning, never by a keyword list: continue = user wants the remaining/next/more results of the same incomplete operation without changing its scope; refine = user keeps the operation but changes its filter/projection; abandon = user moves to a different task or drills into a separate item; none = there is no applicable active operation.',
  'Elliptical natural follow-ups asking for the rest, more, what else exists, or equivalent wording in any language should be operationMove=continue when activeOperation is incomplete. Do not require literal continuation words.',
  'Never invent or rewrite activeOperation tool/filter/cursor values. The runtime, not the model, owns those execution arguments.',
  'For follow-ups such as "tam kod ver", "hata mesajı nedir", "onu göster", corrections and pronouns, produce a self-contained conversationState.resolvedRequest that explicitly carries the active topic/entity from prior USER messages or verifiedFactRefs.',
  'Never promote previous assistant prose into a verified fact. Previous assistant text may indicate conversational topic only; it is not evidence and must not invent activeEntities.',
  'activeEntities must contain literal/canonical enterprise identifiers that are explicit in user messages, verifiedFactRefs, or authoritative prior execution metadata. Never invent acronym expansions.',
  'requestedEvidence describes what proof is requested, for example message_text, trigger_rule, abap_source, document_content, definition, process_rule, comparison or decision.',
  'userDecisions contains only explicit user answers/decisions that may safely carry into an artifact or later turn. Do not put model assumptions there.',
  'Corporate technical facts require JetWork knowledge evidence. Set knowledgeRequired=true for internal SAP/CRM/C4C/IS-U/FICA/Billing/Jira/product/process facts, exact technical identifiers and continuations of those tasks.',
  'Evidence queries must search the resolved request/entity, not the raw elliptical message. Keep them compact.',
  'Set simple_answer/direct only for genuinely self-contained non-enterprise turns.',
  'Set webMode=required for explicitly live/current public verification; if_internal_insufficient only when external verification may be needed after internal evidence.',
  'Set document/artifact only when the user is creating/revising an artifact. Incidental words like analyze or create inside a technical statement are not artifact commands.',
  'Keep goal concise. Never append agent-loop policy, tool instructions or hidden chain-of-thought to goal.',
  'Produce a compact structured execution plan; no final user answer.',
].join('\n')

const cleanText = (value: unknown, max = 4_000) => String(value || '').trim().slice(0, max)
const cleanArray = (value: unknown, limit: number, maxLength: number) => (
  Array.isArray(value)
    ? value.map(item => cleanText(item, maxLength)).filter(Boolean).slice(0, limit)
    : []
)
const unique = (values: string[]) => [...new Set(values.map(item => item.trim()).filter(Boolean))]

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
const TECHNICAL_ENTITY_PATTERN = /\b(?:Z[A-Z0-9_]{2,}(?:[-_/][A-Z0-9_]+)*|CHECK_[A-Z0-9_]+|NINJA_[A-Z0-9_]+|[A-Z][A-Z0-9_]{2,}-\d{2,4})\b/g
const MESSAGE_CODE_PATTERN = /\b([A-Z][A-Z0-9_]{2,})\s*[- ]\s*(\d{2,4})\b/g

const canonicalizeEntity = (value: string) => value.trim().replace(/\s+/g, '').replace(/_?-(?=\d+$)/, '-').toUpperCase()

const extractTechnicalEntities = (text: string): string[] => {
  const values: string[] = []
  for (const match of text.toUpperCase().matchAll(TECHNICAL_ENTITY_PATTERN)) values.push(canonicalizeEntity(match[0]))
  for (const match of text.toUpperCase().matchAll(MESSAGE_CODE_PATTERN)) values.push(`${match[1]}-${match[2]}`)
  return unique(values).slice(0, 10)
}

const fallbackUserMove = (message: string, continuation: boolean): ConversationSemanticState['userMove'] => {
  const normalized = normalizeFallbackText(message)
  if (FALLBACK_REJECTION_PATTERN.test(normalized)) return 'rejection'
  if (FALLBACK_CORRECTION_PATTERN.test(normalized)) return 'correction'
  return continuation ? 'follow_up' : 'new_request'
}

const requestedEvidenceFor = (message: string): string[] => {
  const normalized = normalizeFallbackText(message)
  const evidence: string[] = []
  if (/\b(?:kod|source|kaynak kod|abap|implementasyon|metot|method|fonksiyon)\b/.test(normalized)) evidence.push('abap_source')
  if (/\b(?:hata mesaji|mesaj metni|message text|mesaji nedir)\b/.test(normalized)) evidence.push('message_text')
  if (/\b(?:hangi kosul|kosulda|tetik|neden|ne zaman)\b/.test(normalized)) evidence.push('trigger_rule')
  if (/\b(?:dokuman|belge|icerik)\b/.test(normalized)) evidence.push('document_content')
  if (/\b(?:ne demek|nedir|acilimi|tanimi)\b/.test(normalized)) evidence.push('definition')
  if (/\b(?:karsilastir|alternatif|hangisi|karar)\b/.test(normalized)) evidence.push('comparison')
  return unique(evidence.length ? evidence : ['relevant_evidence'])
}

const explicitUserDecisions = (messages: SemanticContextMessage[], currentMessage: string): string[] => {
  const candidates = [...messages.filter(item => item.role === 'user').slice(-4).map(item => item.content), currentMessage]
  const decisions: string[] = []
  for (const candidate of candidates) {
    for (const line of candidate.split(/\r?\n/)) {
      const clean = cleanText(line, 500)
      if (!clean) continue
      if (/^(?:\*\*)?(?:cevap|karar|kabul|seçim|secim)(?:\*\*)?\s*:/iu.test(clean)) decisions.push(clean)
    }
  }
  return unique(decisions).slice(-10)
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

const fallbackTopic = (conversation: SemanticContextMessage[], currentMessage: string) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const item = conversation[index]
    if (item.role !== 'user' || !item.content.trim()) continue
    if (fallbackUserMove(item.content, true) === 'rejection') continue
    const route = routeReasoningRequest(item.content)
    if (route.intent !== 'simple_answer' || route.knowledgeRequired || route.webMode !== 'none') return cleanText(item.content, 500)
  }
  return cleanText(currentMessage, 500)
}

const priorUserEntities = (conversation: SemanticContextMessage[]) => unique(
  conversation.filter(item => item.role === 'user').slice(-6).flatMap(item => extractTechnicalEntities(item.content)),
).slice(-10)

const resolveRequest = (input: {
  currentMessage: string
  continuation: boolean
  activeEntities: string[]
  requestedEvidence: string[]
  topic: string
  priorResolved?: string
}) => {
  const current = cleanText(input.currentMessage, 700)
  if (!input.continuation) return current
  const currentEntities = extractTechnicalEntities(current)
  if (currentEntities.length) return current
  const entity = input.activeEntities[0]
  if (!entity) return cleanText(`${input.topic}: ${current}`, 900)
  const requested = input.requestedEvidence[0]
  if (requested === 'abap_source') return `${entity} için istenen ABAP kaynak/implementasyon kodunu getir: ${current}`
  if (requested === 'message_text') return `${entity} için doğrulanmış exact hata mesajı metnini getir: ${current}`
  if (requested === 'trigger_rule') return `${entity} için doğrulanmış tetiklenme koşulunu getir: ${current}`
  return `${entity} bağlamında ${current}`
}

const hypothesisExcerpt = (value: string) => cleanText(value.replace(/\s+/g, ' '), 320)
const collectFallbackRejectedHypotheses = (conversation: SemanticContextMessage[], currentMessage: string): string[] => {
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

const promptProfileFor = (
  intent: ReasoningIntent,
  executionMode: ReasoningExecutionMode,
  knowledgeRequired: boolean,
  webMode: ReasoningPlan['webMode'],
): AssistantPromptProfile => {
  if (executionMode === 'artifact') return 'artifact'
  if (intent === 'document') return 'document'
  if (webMode !== 'none' || intent === 'research') return 'research'
  if (knowledgeRequired || ['analysis','sap_diagnosis'].includes(intent)) return 'knowledge'
  return 'base'
}

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
  const intent: ReasoningIntent = preserveKnowledgeTask && activePriorIntent !== 'none' ? activePriorIntent : currentRoute.intent
  const knowledgeRequired = preserveKnowledgeTask || currentRoute.knowledgeRequired || userMove === 'rejection' || userMove === 'correction'
  const webMode = currentRoute.webMode
  const topic = fallbackTopic(conversation, currentMessage)
  const currentEntities = extractTechnicalEntities(currentMessage)
  const activeEntities = unique([
    ...currentEntities,
    ...(priorExecution?.activeEntities || []),
    ...(priorExecution?.verifiedFactRefs || []),
    ...priorUserEntities(conversation),
  ]).slice(0, 10)
  const requestedEvidence = requestedEvidenceFor(currentMessage)
  const resolvedRequest = resolveRequest({
    currentMessage,
    continuation,
    activeEntities,
    requestedEvidence,
    topic,
    priorResolved: priorExecution?.resolvedRequest,
  })
  const rejectedHypotheses = collectFallbackRejectedHypotheses(conversation, currentMessage)
  const retainedContext = conversation
    .slice(-4)
    .map(item => cleanText(`${item.role}: ${item.content}`, 420))
    .filter(Boolean)
  const state: ConversationSemanticState = {
    continuation,
    topic,
    userMove,
    operationMove: 'none',
    priorIntent: activePriorIntent,
    rejectedHypotheses,
    retainedContext: [
      ...retainedContext,
      ...(previousAssistant && !retainedContext.some(item => item.includes(previousAssistant.slice(0, 60)))
        ? [cleanText(`assistant-topic-only: ${previousAssistant}`, 320)]
        : []),
    ].slice(-5),
    openQuestions: [],
    resolvedRequest,
    activeEntities,
    requestedEvidence,
    userDecisions: explicitUserDecisions(conversation, currentMessage),
    verifiedFactRefs: unique(priorExecution?.verifiedFactRefs || []).slice(0, 12),
  }
  const executionMode = executionModeForIntent(intent, knowledgeRequired, webMode)
  const evidenceQueries = knowledgeRequired
    ? unique([resolvedRequest, ...activeEntities].map(item => cleanText(item, 350))).slice(0, 3)
    : []
  return {
    intent,
    complexity: currentRoute.complexity === 'high' || priorExecution?.complexity === 'high' ? 'high' : 'medium',
    executionMode,
    goal: resolvedRequest || cleanText(currentMessage, 800),
    knowledgeRequired,
    webMode,
    verificationRequired: currentRoute.verificationRequired || intent === 'sap_diagnosis',
    creativeMode: currentRoute.creativeMode,
    evidenceQueries,
    steps: [
      ...(knowledgeRequired ? [{ id: 'evidence-internal', label: 'Çözümlenmiş talep için kurumsal kanıtı getir', toolHint: 'knowledge' as const, successCriteria: 'Aktif entity/talebi destekleyen doğrulanmış kanıt bulunur veya eksik olduğu belirlenir.' }] : []),
      { id: 'synthesize', label: 'Kanıt ve konuşma bağlamıyla yanıtı üret', toolHint: 'synthesis', successCriteria: 'Yanıt resolvedRequest ile uyumludur ve kanıtsız teknik gerçek üretmez.' },
    ],
    conversationState: state,
    orchestratorVersion: `${SEMANTIC_ORCHESTRATOR_VERSION}-safe-fallback`,
    promptProfile: promptProfileFor(intent, executionMode, knowledgeRequired, webMode),
  }
}

const normalizePlan = (value: ReasoningPlan, fallback: ReasoningPlan): ReasoningPlan => {
  const intents: ReasoningIntent[] = ['simple_answer','sap_diagnosis','research','analysis','document','decision','project']
  const modes: ReasoningExecutionMode[] = ['direct','knowledge','research','artifact','decision','project']
  const intent = intents.includes(value.intent) ? value.intent : fallback.intent
  const executionMode = value.executionMode && modes.includes(value.executionMode) ? value.executionMode : fallback.executionMode
  const proposedState = value.conversationState && typeof value.conversationState === 'object' ? value.conversationState : fallback.conversationState
  const fallbackState = fallback.conversationState
  const continuation = proposedState?.continuation === true || fallbackState?.continuation === true
  const modelEntities = cleanArray(proposedState?.activeEntities, 10, 180)
  const activeEntities = unique([
    ...modelEntities,
    ...(fallbackState?.activeEntities || []),
    ...(fallbackState?.verifiedFactRefs || []),
  ]).slice(0, 10)
  const requestedEvidence = unique([
    ...cleanArray(proposedState?.requestedEvidence, 8, 120),
    ...(fallbackState?.requestedEvidence || []),
  ]).slice(0, 8)
  const modelResolved = cleanText(proposedState?.resolvedRequest, 900)
  const fallbackResolved = cleanText(fallbackState?.resolvedRequest, 900)
  const resolvedRequest = continuation && activeEntities.length && !activeEntities.some(entity => modelResolved.toUpperCase().includes(entity.toUpperCase()))
    ? fallbackResolved || modelResolved
    : modelResolved || fallbackResolved
  const state: ConversationSemanticState | undefined = proposedState ? {
    ...proposedState,
    continuation,
    topic: cleanText(proposedState.topic || fallbackState?.topic, 500),
    operationMove: ['none','continue','refine','abandon'].includes(String(proposedState.operationMove || ''))
      ? proposedState.operationMove
      : (fallbackState?.operationMove || 'none'),
    rejectedHypotheses: unique([...(fallbackState?.rejectedHypotheses || []), ...(proposedState.rejectedHypotheses || [])]).slice(-6),
    rejectedScopes: unique([...(fallbackState?.rejectedScopes || []), ...(proposedState.rejectedScopes || [])]).slice(-6),
    retainedContext: cleanArray(proposedState.retainedContext?.length ? proposedState.retainedContext : fallbackState?.retainedContext, 6, 500),
    openQuestions: cleanArray(proposedState.openQuestions, 6, 500),
    resolvedRequest,
    activeEntities,
    requestedEvidence,
    userDecisions: unique([...(fallbackState?.userDecisions || []), ...cleanArray(proposedState.userDecisions, 10, 500)]).slice(-10),
    verifiedFactRefs: unique([...(fallbackState?.verifiedFactRefs || []), ...cleanArray(proposedState.verifiedFactRefs, 12, 320)]).slice(0, 12),
  } : fallbackState
  const normalizedExecutionMode = executionMode || executionModeForIntent(intent, Boolean(value.knowledgeRequired), value.webMode)
  const profile = String(value.promptProfile || '') as AssistantPromptProfile
  const promptProfile = ['base','knowledge','research','document','artifact'].includes(profile)
    ? profile
    : promptProfileFor(intent, normalizedExecutionMode, Boolean(value.knowledgeRequired), value.webMode)
  const evidenceQueries = unique([
    ...cleanArray(value.evidenceQueries, 5, 400),
    ...(state?.resolvedRequest ? [state.resolvedRequest] : []),
  ]).slice(0, 5)
  const plan: ReasoningPlan = {
    ...fallback,
    ...value,
    intent,
    executionMode: normalizedExecutionMode,
    goal: cleanText(state?.resolvedRequest || value.goal || fallback.goal, 1_000),
    evidenceQueries,
    steps: Array.isArray(value.steps) ? value.steps.slice(0, 8) : fallback.steps,
    conversationState: state,
    orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
    promptProfile,
  }
  if (plan.knowledgeRequired && !plan.evidenceQueries.length && state?.resolvedRequest) plan.evidenceQueries = [state.resolvedRequest]
  if (plan.intent === 'sap_diagnosis' || state?.userMove === 'rejection' || state?.userMove === 'correction') {
    plan.knowledgeRequired = true
    plan.verificationRequired = true
    if (plan.complexity === 'low') plan.complexity = 'medium'
  }
  if (state?.continuation && state.priorIntent === 'sap_diagnosis') {
    plan.intent = 'sap_diagnosis'
    plan.executionMode = 'knowledge'
    plan.knowledgeRequired = true
    plan.verificationRequired = true
    if (plan.complexity === 'low') plan.complexity = 'medium'
  }
  return plan
}

const boundedKnowledgePlan = (plan: ReasoningPlan) => Boolean(
  plan.knowledgeRequired
  && plan.webMode === 'none'
  && plan.verificationRequired !== true
  && plan.complexity !== 'high'
  && ['simple_answer','analysis'].includes(plan.intent)
)

export const applyAgentLoopPolicy = (inputPlan: ReasoningPlan, provider: AssistantProvider): ReasoningPlan => {
  const plan: ReasoningPlan = {
    ...inputPlan,
    evidenceQueries: [...(inputPlan.evidenceQueries || [])],
    steps: [...(inputPlan.steps || [])],
    conversationState: inputPlan.conversationState ? { ...inputPlan.conversationState } : inputPlan.conversationState,
    orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
  }
  const needsEvidenceCapability = plan.knowledgeRequired || plan.webMode !== 'none'
  if (!needsEvidenceCapability || plan.executionMode === 'artifact' || plan.intent === 'document') return plan

  const requestedWebMode = plan.webMode
  const providerNativeWeb = provider === 'gemini' && requestedWebMode !== 'none'
  const requiredWeb = requestedWebMode === 'required'
  if (providerNativeWeb) {
    plan.goal = `${cleanText(plan.goal, 850)}\n${PROVIDER_WEB_CAPABILITY_MARKER}`.trim()
    plan.knowledgeRequired = true
    plan.webMode = 'none'
  } else if (provider === 'openai' && requiredWeb) {
    plan.webMode = 'if_internal_insufficient'
  }

  // Short Gemini knowledge turns are resolved deterministically by the Gemini
  // provider boundary. OpenAI still needs a core preflight query so the final
  // model cannot skip tools and later trip the grounding completion guard.
  if (boundedKnowledgePlan(plan) && provider === 'gemini') plan.evidenceQueries = []
  else if (plan.knowledgeRequired && !plan.evidenceQueries.length && plan.conversationState?.resolvedRequest) {
    plan.evidenceQueries = [cleanText(plan.conversationState.resolvedRequest, 350)]
  }

  plan.steps = [
    {
      id: 'adaptive-evidence-loop',
      label: 'Çözümlenmiş talep için en uygun kanıt capabilitysini kullan',
      toolHint: plan.knowledgeRequired ? 'knowledge' : (requestedWebMode !== 'none' ? 'web' : 'none'),
      successCriteria: 'Sadece talebi gerçekten destekleyen kanıt tutulur; zayıf adaylar citation sayılmaz.',
    },
    {
      id: 'synthesize',
      label: 'Doğrulanmış kanıtlarla yanıtı sentezle',
      toolHint: 'synthesis',
      successCriteria: 'Yanıt resolvedRequest ile tutarlı ve kanıt sınırları açık olacak şekilde üretilir.',
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
    if (String((input.value as ReasoningPlan).orchestratorVersion || '').includes('safe-fallback')) {
      adapted.orchestratorVersion = String((input.value as ReasoningPlan).orchestratorVersion).slice(0, 80)
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

async function withSemanticRetry<T>(provider: AssistantProvider, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
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
      max_output_tokens: 1_400,
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
  ? { maxOutputTokens: 1_400, responseMimeType: 'application/json' }
  : {
      maxOutputTokens: 1_400,
      thinkingConfig: { thinkingLevel: 'minimal' },
      responseFormat: { text: { mimeType: 'application/json', schema: planSchema } },
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
  const metadata = body.usageMetadata && typeof body.usageMetadata === 'object' ? body.usageMetadata as Record<string, unknown> : {}
  const rawUsage = {
    input_tokens: Number(metadata.promptTokenCount || 0),
    output_tokens: Number(metadata.candidatesTokenCount || 0),
    reasoning_tokens: Number(metadata.thoughtsTokenCount || 0),
    total_tokens: Number(metadata.totalTokenCount || 0),
  }
  return { plan: JSON.parse(text) as ReasoningPlan, usage: usageWithGeminiEstimatedCost(input.model, rawUsage) }
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
    return resilientFallbackResult({ fallback, provider: input.provider, model: semanticModel, reason: 'missing-api-key' })
  }
  const payload = {
    currentUserMessage: currentMessage,
    recentConversation: conversation,
    priorExecution: input.priorExecution || null,
    fallbackResolvedState: fallback.conversationState || null,
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
    console.warn('Semantic orchestrator failed; resolved-context fallback will be used:', {
      provider: input.provider,
      model: semanticModel,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
    return resilientFallbackResult({ fallback, provider: input.provider, model: semanticModel, reason })
  }
}

export const attachSemanticPlan = (message: string, plan: ReasoningPlan) => [
  message.trim(),
  '',
  SEMANTIC_PLAN_START,
  JSON.stringify(plan),
  SEMANTIC_PLAN_END,
].join('\n')