import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/454b7376c1431709fb4a35ec9647bf7ee091abe3/supabase/functions/_shared/reasoningEngine.ts?primary-agent-runtime=1'
import type {
  ReasoningPlan,
  ReasoningRoute,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/454b7376c1431709fb4a35ec9647bf7ee091abe3/supabase/functions/_shared/reasoningEngine.ts?primary-agent-runtime-types=1'

export {
  collectWebSources,
  reasoningEffort,
  routeLabel,
  runRequiredWebResearch,
  verifyReasoningEvidence,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/454b7376c1431709fb4a35ec9647bf7ee091abe3/supabase/functions/_shared/reasoningEngine.ts?primary-agent-runtime-exports=1'
export type * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/454b7376c1431709fb4a35ec9647bf7ee091abe3/supabase/functions/_shared/reasoningEngine.ts?primary-agent-runtime-type-exports=1'

const PLAN_START = '[JETWORK_SEMANTIC_PLAN]'
const PLAN_END = '[END_JETWORK_SEMANTIC_PLAN]'

const attachedPlan = (message: string): ReasoningPlan | null => {
  const start = message.indexOf(PLAN_START)
  if (start < 0) return null
  const contentStart = start + PLAN_START.length
  const end = message.indexOf(PLAN_END, contentStart)
  if (end < 0) return null
  try {
    const value = JSON.parse(message.slice(contentStart, end).trim())
    return value && typeof value === 'object' ? value as ReasoningPlan : null
  } catch {
    return null
  }
}

const fallbackPlan = (message: string): ReasoningPlan => ({
  intent: 'analysis',
  complexity: 'medium',
  executionMode: 'direct',
  goal: message.slice(0, 8_000),
  knowledgeRequired: true,
  enterpriseGroundingRequired: false,
  webMode: 'if_internal_insufficient',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  promptProfile: 'base',
  steps: [{
    id: 'primary-model-capability-loop',
    label: 'Primary model owns request interpretation and capability selection',
    toolHint: 'synthesis',
    successCriteria: 'No user-semantic route is inferred before the primary model.',
  }],
  orchestratorVersion: 'primary-agent-semantic-free-v1',
})

const planFor = (message: string) => attachedPlan(message) || fallbackPlan(message)

export const semanticPlanFromMessage = (message: string): ReasoningPlan | null => attachedPlan(message)

export const routeReasoningRequest = (message: string, _attachmentCount = 0): ReasoningRoute => {
  const plan = planFor(message)
  return {
    intent: plan.intent,
    complexity: plan.complexity,
    knowledgeRequired: plan.knowledgeRequired,
    webMode: plan.webMode,
    verificationRequired: plan.verificationRequired,
    creativeMode: plan.creativeMode,
  }
}

export const routingSurfaceFromMessage = (message: string) => {
  const start = message.indexOf(PLAN_START)
  return { current: (start >= 0 ? message.slice(0, start) : message).trim(), plan: attachedPlan(message) }
}

export async function buildReasoningPlan(
  input: Parameters<typeof original.buildReasoningPlan>[0],
): Promise<Awaited<ReturnType<typeof original.buildReasoningPlan>>> {
  return {
    plan: planFor(input.message),
    usage: { primary_agent_reasoning_router_bypassed: 1 },
    plannerFallback: false,
  }
}
