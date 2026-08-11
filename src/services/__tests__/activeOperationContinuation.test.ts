import { describe, expect, it } from 'vitest'
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy'
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine'

const plan = (operationMove: 'none'|'continue'|'refine'|'abandon', orchestratorVersion = 'semantic-orchestrator-v3.4-active-operation'): ReasoningPlan => ({
  intent: 'analysis', complexity: 'medium', goal: 'follow-up', knowledgeRequired: true,
  webMode: 'none', verificationRequired: false, creativeMode: false, evidenceQueries: [], steps: [],
  executionMode: 'knowledge', orchestratorVersion,
  conversationState: {
    continuation: operationMove === 'continue', topic: 'message inventory', userMove: 'follow_up',
    operationMove, priorIntent: 'analysis', rejectedHypotheses: [], retainedContext: [], openQuestions: [],
  },
})

const priorExecution = {
  activeOperation: {
    kind: 'knowledge_inventory' as const,
    tool: 'list_knowledge_catalog' as const,
    objectType: 'message', prefix: null,
    nextCursor: 'message:zcrm_price_key-045', complete: false,
    totalCount: 227, collectedCount: 75, pageCount: 3,
  },
}

describe('structured active-operation continuation', () => {
  it.each([
    'Diğerleri?',
    'Peki geri kalanını göreyim.',
    'What else is in that same list?',
    '続きを見せて',
  ])('resumes from the same authoritative cursor independent of wording: %s', currentMessage => {
    const result = applyConversationScopeInventoryPolicy({
      plan: plan('continue'), currentMessage, conversation: [], priorExecution,
    })
    expect(result.enumerationTarget).toEqual({
      tool: 'list_knowledge_catalog', objectType: 'message', prefix: null,
      cursor: 'message:zcrm_price_key-045',
    })
    expect(result.evidenceQueries).toEqual([])
    expect(result.goal).toContain('message:zcrm_price_key-045')
  })

  it('does not reuse the stale cursor after a semantic topic shift', () => {
    const result = applyConversationScopeInventoryPolicy({
      plan: plan('abandon'), currentMessage: 'KTS ne demek?', conversation: [], priorExecution,
    })
    expect(result.enumerationTarget).toBeUndefined()
  })

  it('does not blindly reuse the old cursor when the user refines the operation', () => {
    const result = applyConversationScopeInventoryPolicy({
      plan: plan('refine'), currentMessage: 'Sadece ZCRM_COST olanları göster', conversation: [], priorExecution,
    })
    expect(result.enumerationTarget?.cursor).not.toBe('message:zcrm_price_key-045')
  })

  it('allows the old phrase matcher only when semantic orchestration is in safe fallback', () => {
    const noFallback = applyConversationScopeInventoryPolicy({
      plan: plan('none'), currentMessage: 'devam', conversation: [], priorExecution,
    })
    expect(noFallback.enumerationTarget).toBeUndefined()

    const fallback = applyConversationScopeInventoryPolicy({
      plan: plan('none', 'semantic-orchestrator-v3.4-active-operation-safe-fallback-provider-error'),
      currentMessage: 'devam', conversation: [], priorExecution,
    })
    expect(fallback.enumerationTarget?.cursor).toBe('message:zcrm_price_key-045')
  })
})
