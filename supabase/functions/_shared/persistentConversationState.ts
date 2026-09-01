import type { ReasoningPlan } from './reasoningEngine.ts'
import {
  compactResolvedConversationItems,
  type ResolvedConversationContextSeed,
} from './resolvedConversationContext.ts'

const PERSISTED_HISTORY_CHARACTERS = 12_000
const PERSISTED_RECENT_ITEMS = 6
const PERSISTED_RELEVANT_OLDER_USER_ITEMS = 4

const contextSeedForPlan = (plan?: ReasoningPlan): ResolvedConversationContextSeed => ({
  resolvedRequest: String(plan?.conversationState?.resolvedRequest || plan?.goal || '').trim() || undefined,
  topic: String(plan?.conversationState?.topic || '').trim() || undefined,
  activeEntities: plan?.conversationState?.activeEntities || [],
  userDecisions: plan?.conversationState?.userDecisions || [],
  rejectedScopes: plan?.conversationState?.rejectedScopes || [],
  rejectedHypotheses: plan?.conversationState?.rejectedHypotheses || [],
  openQuestions: plan?.conversationState?.openQuestions || [],
  retainedContext: plan?.conversationState?.retainedContext || [],
  verifiedFactRefs: plan?.conversationState?.verifiedFactRefs || [],
})

/**
 * Conversation persistence is a continuity cache, not a transcript archive.
 * Keep a small recent window plus older user-authored context that is relevant
 * to the resolved task. Provider/tool protocol is not reconstructed here; the
 * active provider round keeps its own full function-call tail separately.
 */
export const compactPersistentConversationState = (
  items: Array<Record<string, unknown>>,
  plan?: ReasoningPlan,
): Array<Record<string, unknown>> => compactResolvedConversationItems(
  items,
  contextSeedForPlan(plan),
  {
    maxHistoricalCharacters: PERSISTED_HISTORY_CHARACTERS,
    recentConversationItems: PERSISTED_RECENT_ITEMS,
    relevantOlderUserItems: PERSISTED_RELEVANT_OLDER_USER_ITEMS,
  },
)
