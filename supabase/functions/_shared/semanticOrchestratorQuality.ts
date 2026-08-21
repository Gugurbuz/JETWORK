import type { AssistantProvider } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/c5567c7de98ee37db40f4e9730275c6835581bad/supabase/functions/_shared/modelProviders.ts?primary-agent-types=1'
import type { AssistantActiveOperation } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/c5567c7de98ee37db40f4e9730275c6835581bad/supabase/functions/_shared/operationState.ts?primary-agent-types=1'
import type { ReasoningPlan } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/c5567c7de98ee37db40f4e9730275c6835581bad/supabase/functions/_shared/reasoningEngine.ts?primary-agent-types=1'

export const SEMANTIC_ORCHESTRATOR_VERSION = 'primary-agent-semantic-free-v1'
export const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
export const SEMANTIC_PLAN_START = '[JETWORK_SEMANTIC_PLAN]'
export const SEMANTIC_PLAN_END = '[END_JETWORK_SEMANTIC_PLAN]'

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

const cleanText = (value: unknown, maxLength = 32_000) => String(value ?? '').trim().slice(0, maxLength)

const primaryAgentPlan = (message: string): ReasoningPlan => ({
  intent: 'analysis',
  complexity: 'medium',
  executionMode: 'direct',
  goal: cleanText(message, 8_000),
  // These flags expose capabilities; they do not force retrieval or grounding.
  // The primary model decides from the full conversation whether a tool is useful.
  knowledgeRequired: true,
  enterpriseGroundingRequired: false,
  webMode: 'if_internal_insufficient',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  promptProfile: 'base',
  steps: [{
    id: 'primary-model-capability-loop',
    label: 'Primary model interprets the request and chooses capabilities when useful',
    toolHint: 'synthesis',
    successCriteria: 'No rule-based intent, entity, relationship, inventory, or grounding route is selected before the primary model sees the conversation.',
  }],
  orchestratorVersion: SEMANTIC_ORCHESTRATOR_VERSION,
})

export const compactSemanticConversation = (messages: SemanticContextMessage[]) => messages.slice(-12)

export const normalizeCachedSemanticPlan = (input: {
  value: unknown
  currentMessage: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ReasoningPlan => primaryAgentPlan(input.currentMessage)

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
  return {
    plan: primaryAgentPlan(input.message),
    usage: {
      primary_agent_semantic_router_bypassed: 1,
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
