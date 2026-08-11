import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy'
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine'

const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260811113500_p0_grounding_inventory_continuation.sql', import.meta.url),
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
    })
    expect(result.evidenceQueries).toEqual([])
    expect(result.goal).toContain('exhaustive inventory')
  })

  it('continues the reproduced second-75 request from the last verified message instead of semantic search', () => {
    const result = applyConversationScopeInventoryPolicy({
      plan: basePlan(),
      currentMessage: '2. 75lik kısmı ver',
      conversation: [
        { role: 'user', content: 'Sistemdeki hata mesajlatı ve geçtikleri metotlatı listele' },
        {
          role: 'assistant',
          content: [
            '[JETWORK_CONVERSATIONAL_MEMORY_NOT_EVIDENCE]',
            'deterministic_enumeration_total=227',
            'sample_records=ZB2B_CIKTI-000, ZB2B_CIKTI-001, ZCRM_PRICE_KEY-042, ZCRM_PRICE_KEY-045',
            'observed_record_names=75',
            '[END_JETWORK_CONVERSATIONAL_MEMORY_NOT_EVIDENCE]',
          ].join('\n'),
        },
      ],
    })

    expect(result.enumerationTarget).toEqual({
      tool: 'list_knowledge_catalog',
      objectType: 'message',
      prefix: '__jetwork_message_methods__|cursor=message:zcrm_price_key-045',
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
})
