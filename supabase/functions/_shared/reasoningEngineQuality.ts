import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/reasoningEngine.ts?quality-base=1'
import type { ReasoningPlan, ReasoningRoute } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/reasoningEngine.ts?quality-types=1'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/reasoningEngine.ts?quality-base=1'

const isBoundedExactEnterprisePlan = (plan: ReasoningPlan | null | undefined) => Boolean(
  plan
  && String(plan.orchestratorVersion || '').includes('quality-recovery-v2')
  && plan.enterpriseGroundingRequired === true
  && plan.knowledgeRequired === true
  && plan.steps?.some(step => step.id === 'exact-enterprise-detail')
)

const preserveBoundedExactPolicy = <T extends ReasoningPlan | null>(plan: T): T => {
  if (!plan || !isBoundedExactEnterprisePlan(plan)) return plan
  return {
    ...plan,
    // Enterprise grounding remains mandatory. This only prevents the generic
    // verification planner from reopening semantic search after an authoritative
    // exact-detail target has already been selected.
    verificationRequired: false,
  } as T
}

export const semanticPlanFromMessage = (message: string): ReasoningPlan | null => (
  preserveBoundedExactPolicy(original.semanticPlanFromMessage(message))
)

export function routeReasoningRequest(message: string, attachmentCount = 0): ReasoningRoute {
  const semantic = semanticPlanFromMessage(message)
  if (semantic) {
    return {
      intent: semantic.intent,
      complexity: semantic.complexity,
      knowledgeRequired: semantic.knowledgeRequired,
      webMode: semantic.webMode,
      verificationRequired: semantic.verificationRequired,
      creativeMode: semantic.creativeMode,
    }
  }
  return original.routeReasoningRequest(message, attachmentCount)
}

export async function buildReasoningPlan(
  input: Parameters<typeof original.buildReasoningPlan>[0],
): Promise<Awaited<ReturnType<typeof original.buildReasoningPlan>>> {
  const result = await original.buildReasoningPlan(input)
  return {
    ...result,
    plan: preserveBoundedExactPolicy(result.plan),
  }
}
