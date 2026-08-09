import {
  SEMANTIC_PLAN_END,
  SEMANTIC_PLAN_START,
  routingSurfaceFromMessage,
  type ConversationSemanticState,
  type ReasoningExecutionMode,
  type ReasoningIntent,
  type ReasoningPlan,
} from './reasoningEngine.ts'
import type { AssistantProvider } from './modelProviders.ts'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
export const SEMANTIC_ORCHESTRATOR_VERSION = 'semantic-orchestrator-v1'

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
  provider: AssistantProvider
  model: string
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
  'You are the JetWork Semantic Orchestrator. You do not answer the user. You decide which execution path JetWork must run.',
  'Understand the CURRENT USER MESSAGE in the context of RECENT CONVERSATION and PRIOR EXECUTION metadata.',
  'Conversation continuity is semantic. Resolve ellipsis, pronouns, corrections, rejections, confirmations and implicit references from context. Never depend on exact keywords, suffixes, regex-like matching or a fixed list of follow-up phrases.',
  'If the current turn continues an unresolved enterprise or technical task, preserve the prior task intent even when the user does not repeat any domain nouns.',
  'If the user corrects or rejects the previous assistant hypothesis during technical diagnosis, preserve diagnosis intent, record the rejected hypothesis, require corporate knowledge again, and generate new evidence queries that challenge or exclude the rejected hypothesis.',
  'PRIOR EXECUTION metadata is authoritative about what JetWork actually did on the previous turn. Previous assistant prose is conversational context only and is never evidence.',
  'Corporate technical facts require JetWork knowledge evidence. Set knowledgeRequired=true for internal SAP/CRM/C4C/IS-U/FICA/Billing/Jira/product/process facts, exact technical identifiers, internal business rules, or continuations of such tasks.',
  'Set simple_answer/direct only when the current request is genuinely self-contained and does not continue an unresolved enterprise, technical, document, decision or project task.',
  'Set webMode=required only when the CURRENT user request semantically asks for live/external/current public information. Historical conversation, generated documents, templates, prior assistant wording and prior web use must not create a new web requirement.',
  'Set document/artifact only when the user is actually asking to create or revise an artifact. Incidental action verbs inside a technical sentence are not document commands.',
  'For design/decision work, use decision mode when alternatives should be evaluated. For technical diagnosis, prefer knowledge mode with verification.',
  'Produce a compact execution plan. No hidden chain-of-thought and no final user answer.',
].join('\n')

const cleanText = (value: unknown, max = 4_000) => String(value || '').trim().slice(0, max)

export const compactSemanticConversation = (messages: SemanticContextMessage[]) => {
  const recent = messages.slice(-10)
  const compact: SemanticContextMessage[] = []
  let characters = 0
  // Newest turns are the highest-value context. Walk backwards and unshift so
  // the final payload stays chronological while never dropping the latest turn
  // merely because an older message consumed the character budget first.
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
  const priorIntent = String(priorExecution?.intent || 'none') as ReasoningIntent | 'none'
  const validPriorIntent: ReasoningIntent | 'none' = [
    'none','simple_answer','sap_diagnosis','research','analysis','document','decision','project',
  ].includes(priorIntent) ? priorIntent : 'none'
  const continuation = Boolean(previousUser && validPriorIntent !== 'none')
  const topic = cleanText(previousUser || currentMessage, 500)
  const evidenceQueries = [previousUser, currentMessage].map(item => cleanText(item, 350)).filter(Boolean)
  const state: ConversationSemanticState = {
    continuation,
    topic,
    userMove: continuation ? 'follow_up' : 'new_request',
    priorIntent: validPriorIntent,
    rejectedHypotheses: [],
    retainedContext: [previousUser, previousAssistant].map(item => cleanText(item, 500)).filter(Boolean),
    openQuestions: [],
  }
  const preserveKnowledgeTask = continuation && (
    validPriorIntent === 'sap_diagnosis'
    || validPriorIntent === 'analysis'
    || priorExecution?.knowledgeUsed === true
  )
  return {
    intent: preserveKnowledgeTask && validPriorIntent !== 'none' ? validPriorIntent : 'analysis',
    complexity: priorExecution?.complexity === 'high' ? 'high' : 'medium',
    executionMode: 'knowledge',
    goal: cleanText(currentMessage, 800) || 'Kullanıcı talebini mevcut konuşma bağlamıyla güvenli biçimde yanıtla.',
    knowledgeRequired: true,
    webMode: 'none',
    verificationRequired: true,
    creativeMode: false,
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
    return normalizePlan(input.value as ReasoningPlan, fallback)
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
    throw new Error(String(detail || `OpenAI semantic orchestration failed with ${response.status}.`))
  }
  const text = openAiText(body)
  if (!text) throw new Error('OpenAI semantic orchestration returned no structured text.')
  return {
    plan: JSON.parse(text) as ReasoningPlan,
    usage: body.usage && typeof body.usage === 'object' ? body.usage as Record<string, number> : undefined,
  }
}

async function requestGeminiPlan(input: { apiKey: string; model: string; payload: Record<string, unknown>; signal?: AbortSignal }) {
  const response = await fetch(`${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`, {
    method: 'POST', signal: input.signal,
    headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input.payload) }] }],
      generationConfig: {
        maxOutputTokens: 2_400,
        thinkingConfig: { thinkingLevel: 'low' },
        responseMimeType: 'application/json',
        responseSchema: planSchema,
      },
    }),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const detail = (body.error as Record<string, unknown> | undefined)?.message
    throw new Error(String(detail || `Gemini semantic orchestration failed with ${response.status}.`))
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
  if (!input.apiKey) {
    return { plan: fallback, fallbackUsed: true, provider: input.provider, model: input.model }
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
      ? await requestGeminiPlan({ apiKey: input.apiKey, model: input.model, payload, signal: input.signal })
      : await requestOpenAiPlan({ apiKey: input.apiKey, model: input.model, payload, signal: input.signal })
    return {
      plan: normalizePlan(result.plan, fallback),
      usage: result.usage,
      fallbackUsed: false,
      provider: input.provider,
      model: input.model,
    }
  } catch (error) {
    console.warn('Semantic orchestrator failed; conservative knowledge-first fallback will be used:', error)
    return { plan: fallback, fallbackUsed: true, provider: input.provider, model: input.model }
  }
}

export const attachSemanticPlan = (message: string, plan: ReasoningPlan) => [
  message.trim(),
  '',
  SEMANTIC_PLAN_START,
  JSON.stringify(plan),
  SEMANTIC_PLAN_END,
].join('\n')
