import type { ReasoningPlan } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/c5567c7de98ee37db40f4e9730275c6835581bad/supabase/functions/_shared/reasoningEngine.ts?primary-agent-scope=1'
import type { PriorExecutionContext, SemanticContextMessage } from './semanticOrchestratorQuality.ts'

export const applyConversationScopeInventoryPolicy = (input: {
  plan: ReasoningPlan
  currentMessage: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ReasoningPlan => input.plan
