import {
  buildReasoningPlan as buildLegacyReasoningPlan,
  collectWebSources,
  reasoningEffort,
  routeLabel,
  routeReasoningRequest as routeLegacyReasoningRequest,
  routingSurfaceFromMessage as legacyRoutingSurfaceFromMessage,
  runRequiredWebResearch,
  verifyReasoningEvidence,
  type ReasoningComplexity,
  type ReasoningIntent,
  type ReasoningPlan as LegacyReasoningPlan,
  type ReasoningPlanStep,
  type ReasoningRoute,
  type ReasoningSourceRef,
  type VerificationResult,
  type WebMode,
  type WebResearchResult,
} from './reasoningEngineLegacy.ts'
import { isAgentControllerV2Enabled } from './runtime/runtimeFlags.ts'
import { hasExactTechnicalIdentifier } from './technicalIdentifier.ts'

export {
  collectWebSources,
  reasoningEffort,
  routeLabel,
  runRequiredWebResearch,
  verifyReasoningEvidence,
}
export type {
  ReasoningComplexity,
  ReasoningIntent,
  ReasoningPlanStep,
  ReasoningRoute,
  ReasoningSourceRef,
  VerificationResult,
  WebMode,
  WebResearchResult,
}

export type ReasoningExecutionMode = 'direct' | 'knowledge' | 'research' | 'artifact' | 'decision' | 'project'
export type KnowledgeEnumerationTool = 'list_knowledge_catalog' | 'list_class_inventory'
export type AssistantPromptProfile = 'base' | 'knowledge' | 'research' | 'document' | 'artifact'

export interface KnowledgeEnumerationTarget {
  tool: KnowledgeEnumerationTool
  objectType: string | null
  prefix: string | null
  cursor: string | null
}

export interface ConversationSemanticState {
  continuation: boolean
  topic: string
  userMove: 'new_request' | 'follow_up' | 'correction' | 'rejection' | 'confirmation' | 'clarification' | 'topic_shift'
  operationMove?: 'none' | 'continue' | 'refine' | 'abandon'
  priorIntent: ReasoningIntent | 'none'
  rejectedHypotheses: string[]
  rejectedScopes?: string[]
  retainedContext: string[]
  openQuestions: string[]
  resolvedRequest?: string
  activeEntities?: string[]
  requestedEvidence?: string[]
  userDecisions?: string[]
  verifiedFactRefs?: string[]
}

export interface ReasoningPlan extends LegacyReasoningPlan {
  // knowledgeRequired decides whether enterprise/project retrieval should run.
  // enterpriseGroundingRequired is narrower: when true, authoritative enterprise
  // facts must be supported before they can appear in the final answer.
  enterpriseGroundingRequired?: boolean
  executionMode?: ReasoningExecutionMode
  conversationState?: ConversationSemanticState
  enumerationTarget?: KnowledgeEnumerationTarget
  orchestratorVersion?: string
  promptProfile?: AssistantPromptProfile
}

export const SEMANTIC_PLAN_START = '[JETWORK_SEMANTIC_PLAN]'
export const SEMANTIC_PLAN_END = '[END_JETWORK_SEMANTIC_PLAN]'
const SEMANTIC_PLAN_PATTERN = /\[JETWORK_SEMANTIC_PLAN\]\s*([\s\S]*?)\s*\[END_JETWORK_SEMANTIC_PLAN\]/i
const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
const ENTERPRISE_SURFACE_PATTERN = /(?:\bSAP\b|\bCRM\b|\bC4C\b|\bIS[- ]?U\b|\bFICA\b|\bABAP\b|\bJIRA\b|\bENERJISA\b|\bZ[A-Z0-9_]{2,}\b|\bCHECK_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9_]{2,}-\d{2,4}\b)/i
const BARE_TOPIC_QUESTION_PATTERN = /\b(?:ne|nedir|kim|nerede|ne zaman|nasil|neden|niye|hangi|hakkinda|anlat|acikla|bilgi|guncel|son durum|durum|performans|haber|kac|mi|mı|mu|mü|what|who|where|when|how|why|latest|current|news)\b/i

const cleanStringArray = (value: unknown, limit = 8, maxLength = 500): string[] => (
  Array.isArray(value)
    ? value.map(item => String(item || '').trim().slice(0, maxLength)).filter(Boolean).slice(0, limit)
    : []
)

const normalizeForIntent = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const currentMessageWithoutPlan = (message: string) => message.replace(SEMANTIC_PLAN_PATTERN, '').trim()

const isBareTopicSurface = (message: string): boolean => {
  const current = message.trim()
  if (!current || current.length > 100 || /[?\n]/.test(current) || ENTERPRISE_SURFACE_PATTERN.test(current)) return false
  const normalized = normalizeForIntent(current)
  if (!normalized || BARE_TOPIC_QUESTION_PATTERN.test(normalized)) return false
  const words = normalized.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 4 && /^[\p{L}\p{M}\d.'’&+\- ]+$/u.test(current)
}

const semanticPlannerExpandedBareTopic = (input: {
  raw: Record<string, unknown>
  currentMessage: string
  intent: ReasoningIntent
  rawWebMode: WebMode
}): boolean => {
  if (!isBareTopicSurface(input.currentMessage)) return false

  // Enumeration is an explicit enterprise capability decision, not a public
  // bare-topic expansion. Never discard its target/cursor metadata here.
  if (input.raw.enumerationTarget && typeof input.raw.enumerationTarget === 'object') return false

  const rawGoal = String(input.raw.goal || '')
  const executionMode = String(input.raw.executionMode || '')
  const stateRaw = input.raw.conversationState && typeof input.raw.conversationState === 'object'
    ? input.raw.conversationState as Record<string, unknown>
    : undefined
  const resolvedRequest = String(stateRaw?.resolvedRequest || '').trim()
  const normalizedCurrent = normalizeForIntent(input.currentMessage)
  const normalizedResolved = normalizeForIntent(resolvedRequest)
  const changedResolvedRequest = Boolean(normalizedResolved && normalizedResolved !== normalizedCurrent)

  return input.raw.knowledgeRequired === true
    || input.rawWebMode !== 'none'
    || rawGoal.includes(PROVIDER_WEB_CAPABILITY_MARKER)
    || input.intent !== 'simple_answer'
    || executionMode !== 'direct'
    || changedResolvedRequest
}

const normalizeKnownEntityAlias = (value: string) => {
  const raw = String(value || '').trim()
  const upper = raw.toLocaleUpperCase('tr-TR')
  if (/^ZCRMCOST[- ]\d{2,4}$/.test(upper)) return upper.replace(/^ZCRMCOST[- ]/, 'ZCRM_COST-')
  if (/^MESSAGE:ZCRMCOST-\d{2,4}$/i.test(raw)) return raw.toLocaleLowerCase('en-US').replace('message:zcrmcost-', 'message:zcrm_cost-')
  return raw
}

const normalizeEntityArray = (value: unknown, limit = 10, maxLength = 320) => (
  [...new Set(cleanStringArray(value, limit * 2, maxLength).map(normalizeKnownEntityAlias))].slice(0, limit)
)

const normalizeEnumerationTarget = (value: unknown): KnowledgeEnumerationTarget | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const tool = String(raw.tool || '') as KnowledgeEnumerationTool
  if (!['list_knowledge_catalog','list_class_inventory'].includes(tool)) return undefined
  const objectType = raw.objectType === null || raw.objectType === undefined
    ? null
    : String(raw.objectType || '').trim().slice(0, 40) || null
  const prefix = raw.prefix === null || raw.prefix === undefined
    ? null
    : String(raw.prefix || '').trim().slice(0, 160) || null
  const cursor = raw.cursor === null || raw.cursor === undefined
    ? null
    : String(raw.cursor || '').trim().slice(0, 320) || null
  return { tool, objectType, prefix, cursor }
}

const promptProfileForPlan = (
  intent: ReasoningIntent,
  executionMode: ReasoningExecutionMode | undefined,
  knowledgeRequired: boolean,
  webMode: WebMode,
): AssistantPromptProfile => {
  if (intent === 'document') return executionMode === 'artifact' ? 'artifact' : 'document'
  if (executionMode === 'artifact') return 'artifact'
  if (webMode !== 'none' || intent === 'research') return 'research'
  if (knowledgeRequired || intent === 'sap_diagnosis') return 'knowledge'
  return 'base'
}

const bareTopicPlan = (message: string, orchestratorVersion: string): ReasoningPlan => ({
  intent: 'simple_answer',
  complexity: 'low',
  goal: `Kullanıcı yalnızca "${message.slice(0, 100)}" konusunu yazdı. Neyi merak ettiğini tek kısa soruyla netleştir. Kullanıcının yerine ek bir bilgi talebi, amaç veya bağlam uydurma.`,
  knowledgeRequired: false,
  enterpriseGroundingRequired: false,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [{
    id: 'clarify-bare-topic',
    label: 'Kullanıcının bu konu hakkında ne öğrenmek istediğini netleştir',
    toolHint: 'synthesis',
    successCriteria: 'Yanıt yalnız kısa bir netleştirme sorusudur ve yeni fact üretmez.',
  }],
  executionMode: 'direct',
  conversationState: {
    continuation: false,
    topic: message.slice(0, 500),
    userMove: 'new_request',
    operationMove: 'none',
    priorIntent: 'none',
    rejectedHypotheses: [],
    rejectedScopes: [],
    retainedContext: [],
    openQuestions: [],
    resolvedRequest: message.slice(0, 900),
    activeEntities: [],
    requestedEvidence: [],
    userDecisions: [],
    verifiedFactRefs: [],
  },
  orchestratorVersion: `${orchestratorVersion}-bare-topic-safety`,
  promptProfile: 'base',
})

const normalizeSemanticPlan = (value: unknown, currentMessage = ''): ReasoningPlan | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const intent = String(raw.intent || '') as ReasoningIntent
  const complexity = String(raw.complexity || '') as ReasoningComplexity
  const rawWebMode = String(raw.webMode || '') as WebMode
  if (!['simple_answer','sap_diagnosis','research','analysis','document','decision','project'].includes(intent)) return null
  if (!['low','medium','high'].includes(complexity)) return null
  if (!['none','required','if_internal_insufficient'].includes(rawWebMode)) return null

  const rawGoal = String(raw.goal || '').trim().slice(0, 1_000)
  const orchestratorVersion = String(raw.orchestratorVersion || 'semantic-orchestrator-v1').slice(0, 80)
  if (currentMessage && semanticPlannerExpandedBareTopic({ raw, currentMessage, intent, rawWebMode })) {
    return bareTopicPlan(currentMessage, orchestratorVersion)
  }

  const currentRoute = routeLegacyReasoningRequest(currentMessage || rawGoal)
  const providerWebMarker = rawGoal.includes(PROVIDER_WEB_CAPABILITY_MARKER)
  const requestedExecutionMode = String(raw.executionMode || '') as ReasoningExecutionMode
  const rawKnowledgeRequired = raw.knowledgeRequired === true
  const explicitEnterpriseFlag = typeof raw.enterpriseGroundingRequired === 'boolean'
    ? raw.enterpriseGroundingRequired
    : undefined

  // Public web evidence and enterprise evidence are separate trust domains.
  // Provider-native Gemini web remains encoded as a marker with webMode=none;
  // the Gemini provider consumes the marker directly. Never rehydrate it into
  // required/conditional mode because those modes invoke the OpenAI web executor.
  const routeSaysEnterprise = currentRoute.knowledgeRequired === true || ENTERPRISE_SURFACE_PATTERN.test(currentMessage)
  const enterpriseGroundingRequired = explicitEnterpriseFlag !== undefined
    ? explicitEnterpriseFlag
    : Boolean(intent === 'sap_diagnosis' || (rawKnowledgeRequired && routeSaysEnterprise))
  const knowledgeRequired = providerWebMarker && !routeSaysEnterprise
    ? false
    : Boolean(rawKnowledgeRequired || enterpriseGroundingRequired)
  const webMode: WebMode = providerWebMarker ? 'none' : rawWebMode

  const evidenceRequiredSimpleAnswer = knowledgeRequired && intent === 'simple_answer'
  const normalizedIntent: ReasoningIntent = evidenceRequiredSimpleAnswer ? 'analysis' : intent
  const derivedExecutionMode: ReasoningExecutionMode = (() => {
    if (normalizedIntent === 'document') return 'artifact'
    if (normalizedIntent === 'decision') return 'decision'
    if (normalizedIntent === 'project') return 'project'
    if (normalizedIntent === 'research' || webMode !== 'none') return 'research'
    if (knowledgeRequired || normalizedIntent === 'sap_diagnosis') return 'knowledge'
    return 'direct'
  })()
  const normalizedExecutionMode: ReasoningExecutionMode = requestedExecutionMode === 'knowledge' && !knowledgeRequired && normalizedIntent !== 'sap_diagnosis'
    ? derivedExecutionMode
    : (knowledgeRequired && requestedExecutionMode === 'direct'
      ? derivedExecutionMode
      : (['direct','knowledge','research','artifact','decision','project'].includes(requestedExecutionMode) ? requestedExecutionMode : derivedExecutionMode))
  const stateRaw = raw.conversationState && typeof raw.conversationState === 'object'
    ? raw.conversationState as Record<string, unknown>
    : undefined
  const priorIntent = String(stateRaw?.priorIntent || 'none') as ReasoningIntent | 'none'
  const userMove = String(stateRaw?.userMove || 'follow_up') as ConversationSemanticState['userMove']
  const conversationState: ConversationSemanticState | undefined = stateRaw ? {
    continuation: stateRaw.continuation === true,
    topic: String(stateRaw.topic || '').trim().slice(0, 500),
    userMove: ['new_request','follow_up','correction','rejection','confirmation','clarification','topic_shift'].includes(userMove)
      ? userMove
      : 'follow_up',
    operationMove: ['none','continue','refine','abandon'].includes(String(stateRaw.operationMove || ''))
      ? String(stateRaw.operationMove) as ConversationSemanticState['operationMove']
      : 'none',
    priorIntent: ['none','simple_answer','sap_diagnosis','research','analysis','document','decision','project'].includes(priorIntent)
      ? priorIntent
      : 'none',
    rejectedHypotheses: cleanStringArray(stateRaw.rejectedHypotheses, 6),
    rejectedScopes: cleanStringArray(stateRaw.rejectedScopes, 6),
    retainedContext: cleanStringArray(stateRaw.retainedContext, 8, 700),
    openQuestions: cleanStringArray(stateRaw.openQuestions, 6, 500),
    resolvedRequest: String(stateRaw.resolvedRequest || '').trim().slice(0, 900) || undefined,
    activeEntities: normalizeEntityArray(stateRaw.activeEntities, 10, 180),
    requestedEvidence: cleanStringArray(stateRaw.requestedEvidence, 8, 120),
    userDecisions: cleanStringArray(stateRaw.userDecisions, 10, 500),
    verifiedFactRefs: normalizeEntityArray(stateRaw.verifiedFactRefs, 12, 320),
  } : undefined
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step, index) => {
        const candidate = step && typeof step === 'object' ? step as Record<string, unknown> : {}
        const toolHint = String(candidate.toolHint || 'none')
        return {
          id: String(candidate.id || `step-${index + 1}`).slice(0, 80),
          label: String(candidate.label || 'İşlemi yürüt').slice(0, 300),
          toolHint: ['none','knowledge','web','relations','verification','synthesis'].includes(toolHint)
            ? toolHint as ReasoningPlanStep['toolHint']
            : 'none',
          successCriteria: String(candidate.successCriteria || 'Gerekli çıktı güvenli biçimde elde edilir.').slice(0, 500),
        }
      }).slice(0, 8)
    : []
  const profile = String(raw.promptProfile || '') as AssistantPromptProfile
  const promptProfile = ['base','knowledge','research','document','artifact'].includes(profile)
    ? (profile === 'knowledge' && !knowledgeRequired ? promptProfileForPlan(normalizedIntent, normalizedExecutionMode, knowledgeRequired, webMode) : profile)
    : promptProfileForPlan(normalizedIntent, normalizedExecutionMode, knowledgeRequired, webMode)
  return {
    intent: normalizedIntent,
    complexity,
    // Keep the marker internal to the semantic plan so the Gemini provider can
    // detect native web capability without exposing it in user-visible text.
    goal: rawGoal || currentMessage || 'Kullanıcı talebini bağlamı koruyarak doğru yanıtla.',
    knowledgeRequired,
    enterpriseGroundingRequired,
    webMode,
    verificationRequired: raw.verificationRequired === true || enterpriseGroundingRequired,
    creativeMode: raw.creativeMode === true,
    evidenceQueries: knowledgeRequired ? cleanStringArray(raw.evidenceQueries, 5, 400) : [],
    steps,
    executionMode: normalizedExecutionMode,
    conversationState,
    enumerationTarget: normalizeEnumerationTarget(raw.enumerationTarget),
    orchestratorVersion,
    promptProfile,
  }
}

export const semanticPlanFromMessage = (message: string): ReasoningPlan | null => {
  const match = message.match(SEMANTIC_PLAN_PATTERN)
  if (!match?.[1]) return null
  const currentMessage = currentMessageWithoutPlan(message)
  try { return normalizeSemanticPlan(JSON.parse(match[1]), currentMessage) } catch { return null }
}

const controllerV2NeutralPlan = (message: string): ReasoningPlan => {
  const currentMessage = currentMessageWithoutPlan(message).slice(0, 1_000)
  const exactTechnicalEvidenceRequired = hasExactTechnicalIdentifier(currentMessage)
  return {
    intent: 'analysis',
    complexity: 'medium',
    goal: currentMessage || 'Kullanıcı talebini doğru ve güvenli biçimde yanıtla.',
    knowledgeRequired: false,
    enterpriseGroundingRequired: exactTechnicalEvidenceRequired,
    webMode: 'none',
    verificationRequired: false,
    creativeMode: false,
    evidenceQueries: [],
    steps: [{
      id: 'controller-v2-core-fallback',
      label: 'Controller LLM hedefi değerlendirir ve capability seçimini observationlara göre yapar',
      toolHint: 'synthesis',
      successCriteria: exactTechnicalEvidenceRequired
        ? 'Exact teknik iddialar doğrulanmış evidence olmadan kesinleştirilmez; capability seçimini controller yapar.'
        : 'Runtime önceden knowledge/web/skill/artifact seçmez; controller observation sonrası yeniden karar verir.',
    }],
    executionMode: 'direct',
    orchestratorVersion: 'agent-controller-v2-core-neutral-fallback',
    promptProfile: 'base',
  }
}

const controllerV2NeutralRoute = (): ReasoningRoute => ({
  intent: 'analysis',
  complexity: 'medium',
  knowledgeRequired: false,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
})

export const routingSurfaceFromMessage = (message: string) => (
  legacyRoutingSurfaceFromMessage(currentMessageWithoutPlan(message))
)

export function routeReasoningRequest(message: string, attachmentCount = 0): ReasoningRoute {
  const semanticPlan = semanticPlanFromMessage(message)
  if (semanticPlan) {
    return {
      intent: semanticPlan.intent,
      complexity: semanticPlan.complexity,
      knowledgeRequired: semanticPlan.knowledgeRequired,
      webMode: semanticPlan.webMode,
      verificationRequired: semanticPlan.verificationRequired,
      creativeMode: semanticPlan.creativeMode,
    }
  }
  if (isAgentControllerV2Enabled()) return controllerV2NeutralRoute()
  return routeLegacyReasoningRequest(message, attachmentCount)
}

export async function buildReasoningPlan(input: {
  apiKey?: string
  model: string
  message: string
  workspaceTitle?: string
  attachmentNames?: string[]
  route: ReasoningRoute
  signal?: AbortSignal
}): Promise<{ plan: ReasoningPlan; usage?: Record<string, number>; plannerFallback: boolean }> {
  const semanticPlan = semanticPlanFromMessage(input.message)
  if (semanticPlan) return { plan: semanticPlan, plannerFallback: false }
  if (isAgentControllerV2Enabled()) {
    return {
      plan: controllerV2NeutralPlan(input.message),
      usage: { controller_v2_core_neutral_fallback: 1 },
      plannerFallback: false,
    }
  }
  const legacy = await buildLegacyReasoningPlan(input) as {
    plan: ReasoningPlan
    usage?: Record<string, number>
    plannerFallback: boolean
  }
  return {
    ...legacy,
    plan: {
      ...legacy.plan,
      enterpriseGroundingRequired: legacy.plan.knowledgeRequired === true,
    },
  }
}
