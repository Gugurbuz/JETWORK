import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy'
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine'

const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260811113500_p0_grounding_inventory_continuation.sql', import.meta.url),
  'utf8',
)
const failClosedMigrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260812001000_allow_grounding_fail_closed_completion.sql', import.meta.url),
  'utf8',
)

const basePlan = (): ReasoningPlan => ({
  intent: 'analysis',
  complexity: 'medium',
  goal: 'follow up',
  knowledgeRequired: true,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  executionMode: 'knowledge',
  conversationState: {
    continuation: true,
    topic: 'message inventory',
    userMove: 'follow_up',
    priorIntent: 'analysis',
    rejectedHypotheses: [],
    retainedContext: [],
    openQuestions: [],
  },
})

describe('P0 hallucination grounding and inventory continuation', () => {
  it('routes typo-heavy message + method inventory to deterministic authoritative listing', () => {
    const result = applyConversationScopeInventoryPolicy({
      plan: basePlan(),
      currentMessage: 'Sistemdeki hata mesajlatı ve geçtikleri metotlatı listele',
      conversation: [],
    })

    expect(result.enumerationTarget).toEqual({
      tool: 'list_knowledge_catalog',
      objectType: 'message',
      prefix: '__jetwork_message_methods__',
      cursor: null,
    })
    expect(result.evidenceQueries).toEqual([])
    expect(result.goal).toContain('exhaustive inventory')
  })

  it('continues the reproduced second-75 request from structured prior execution state instead of assistant prose', () => {
    const result = applyConversationScopeInventoryPolicy({
      plan: {
        ...basePlan(),
        orchestratorVersion: 'semantic-orchestrator-v3.4-active-operation',
        conversationState: { ...basePlan().conversationState!, operationMove: 'continue' },
      },
      currentMessage: '2. 75lik kısmı ver',
      conversation: [],
      priorExecution: {
        activeOperation: {
          kind: 'knowledge_inventory',
          tool: 'list_knowledge_catalog',
          objectType: 'message',
          prefix: '__jetwork_message_methods__',
          nextCursor: 'message:zcrm_price_key-045',
          complete: false,
        },
      },
    })

    expect(result.enumerationTarget).toEqual({
      tool: 'list_knowledge_catalog',
      objectType: 'message',
      prefix: '__jetwork_message_methods__',
      cursor: 'message:zcrm_price_key-045',
    })
    expect(result.evidenceQueries).toEqual([])
    expect(result.goal).toContain('message:zcrm_price_key-045')
    expect(result.goal).toContain('semantic search başlatma')
  })

  it('enforces authoritative EMITS_MESSAGE enrichment and a hard zero-source completion guard in SQL', () => {
    expect(migrationSource).toContain("r.relation_type = 'EMITS_MESSAGE'")
    expect(migrationSource).toContain('__jetwork_message_methods__|cursor=%')
    expect(migrationSource).toContain('GROUNDING_REQUIRED_NO_VERIFIED_SOURCE')
    expect(migrationSource).toContain("r.plan ->> 'knowledgeRequired'")
    expect(migrationSource).toContain('jsonb_array_elements(p_source_refs)')
    expect(migrationSource).toContain('assistant_reasoning_runs_grounded_knowledge_used')
    expect(migrationSource).toContain("tr.tool_name <> 'web_search'")
  })

  it('allows the explicit fail-closed grounding refusal to complete without source refs', () => {
    expect(failClosedMigrationSource).toContain("p_usage ->> 'grounding_fail_closed'")
    expect(failClosedMigrationSource).toContain("p_usage ->> 'grounding_unverified_provider_text_discarded'")
    expect(failClosedMigrationSource).toContain("like 'Bu teknik yanıtı güvenli biçimde tamamlayamadım:%'")
    expect(failClosedMigrationSource).toContain('not has_verified_source and not grounding_fail_closed')
    expect(failClosedMigrationSource).toContain('GROUNDING_REQUIRED_NO_VERIFIED_SOURCE')
  })
})