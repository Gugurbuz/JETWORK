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
}

export interface ConversationSemanticState {
  continuation: boolean
  topic: string
  userMove: 'new_request' | 'follow_up' | 'correction' | 'rejection' | 'confirmation' | 'clarification' | 'topic_shift'
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
  executionMode?: ReasoningExecutionMode
  conversationState?: ConversationSemanticState
  enumerationTarget?: KnowledgeEnumerationTarget
  orchestratorVersion?: string
  promptProfile?: AssistantPromptProfile
}

export const SEMANTIC_PLAN_START = '[JETWORK_SEMANTIC_PLAN]'
export const SEMANTIC_PLAN_END = '[END_JETWORK_SEMANTIC_PLAN]'
const SEMANTIC_PLAN_PATTERN = /\[JETWORK_SEMANTIC_PLAN\]\s*([\s\S]*?)\s*\[END_JETWORK_SEMANTIC_PLAN\]/i

const cleanStringArray = (value: unknown, limit = 8, maxLength = 500): string[] => (
  Array.isArray(value)
    ? value.map(item => String(item || '').trim().slice(0, maxLength)).filter(Boolean).slice(0, limit)
    : []
)

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
  return { tool, objectType, prefix }
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
  if (knowledgeRequired || ['analysis','sap_diagnosis'].includes(intent)) return 'knowledge'
  return 'base'
}

const normalizeSemanticPlan = (value: unknown): ReasoningPlan | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const intent = String(raw.intent || '') as ReasoningIntent
  const complexity = String(raw.complexity || '') as ReasoningComplexity
  const webMode = String(raw.webMode || '') as WebMode
  if (!['simple_answer','sap_diagnosis','research','analysis','document','decision','project'].includes(intent)) return null
  if (!['low','medium','high'].includes(complexity)) return null
  if (!['none','required','if_internal_insufficient'].includes(webMode)) return null
  const executionMode = String(raw.executionMode || '') as ReasoningExecutionMode
  const knowledgeRequired = raw.knowledgeRequired === true
  const evidenceRequiredSimpleAnswer = knowledgeRequired && intent === 'simple_answer'
  const normalizedIntent: ReasoningIntent = evidenceRequiredSimpleAnswer ? 'analysis' : intent
  const normalizedExecutionMode: ReasoningExecutionMode | undefined = evidenceRequiredSimpleAnswer
    ? 'knowledge'
    : (['direct','knowledge','research','artifact','decision','project'].includes(executionMode) ? executionMode : undefined)
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
    ? profile
    : promptProfileForPlan(normalizedIntent, normalizedExecutionMode, knowledgeRequired, webMode)
  return {
    intent: normalizedIntent,
    complexity,
    goal: String(raw.goal || '').trim().slice(0, 1_000) || 'Kullanıcı talebini bağlamı koruyarak doğru yanıtla.',
    knowledgeRequired,
    webMode,
    verificationRequired: raw.verificationRequired === true,
    creativeMode: raw.creativeMode === true,
    evidenceQueries: cleanStringArray(raw.evidenceQueries, 5, 400),
    steps,
    executionMode: normalizedExecutionMode,
    conversationState,
    enumerationTarget: normalizeEnumerationTarget(raw.enumerationTarget),
    orchestratorVersion: String(raw.orchestratorVersion || 'semantic-orchestrator-v1').slice(0, 80),
    promptProfile,
  }
}

export const semanticPlanFromMessage = (message: string): ReasoningPlan | null => {
  const match = message.match(SEMANTIC_PLAN_PATTERN)
  if (!match?.[1]) return null
  try { return normalizeSemanticPlan(JSON.parse(match[1])) } catch { return null }
}

export const routingSurfaceFromMessage = (message: string) => (
  legacyRoutingSurfaceFromMessage(message.replace(SEMANTIC_PLAN_PATTERN, '').trim())
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
  return buildLegacyReasoningPlan(input) as Promise<{
    plan: ReasoningPlan
    usage?: Record<string, number>
    plannerFallback: boolean
  }>
}