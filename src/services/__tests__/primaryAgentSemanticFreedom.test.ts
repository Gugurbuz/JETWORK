import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('primary-agent semantic freedom', () => {
  it('does not pre-classify user meaning with semantic regexes', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/semanticOrchestratorQuality.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain("primary-agent-semantic-free-v1")
    expect(source).toContain('knowledgeRequired: true')
    expect(source).toContain('enterpriseGroundingRequired: false')
    expect(source).toContain("webMode: 'if_internal_insufficient'")
    expect(source).toContain('evidenceQueries: []')
    expect(source).not.toContain('TECHNICAL_IDENTIFIER')
    expect(source).not.toContain('ENTERPRISE_SURFACE')
    expect(source).not.toContain('INFORMATION_SEEKING')
    expect(source).not.toContain('.matchAll(')
    expect(source).not.toContain('.test(')
  })

  it('disables deterministic conversation-scope and inventory routing', () => {
    const scopeSource = readFileSync(
      new URL('../../../supabase/functions/_shared/conversationScopePolicyPrimary.ts', import.meta.url),
      'utf8',
    )
    const inventorySource = readFileSync(
      new URL('../../../supabase/functions/_shared/authoritativeInventoryFastPathPrimary.ts', import.meta.url),
      'utf8',
    )
    const trivialSource = readFileSync(
      new URL('../../../supabase/functions/_shared/trivialAssistantFastPathPrimary.ts', import.meta.url),
      'utf8',
    )

    expect(scopeSource).toContain('=> input.plan')
    expect(inventorySource).toContain('=> null')
    expect(trivialSource).toContain('=> false')
  })

  it('bypasses the legacy reasoning classifier after the semantic plan is attached', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/reasoningEnginePrimary.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain('primary_agent_reasoning_router_bypassed')
    expect(source).toContain('attachedPlan(message) || fallbackPlan(message)')
    expect(source).not.toContain('ENTERPRISE_SURFACE_PATTERN')
    expect(source).not.toContain('BARE_TOPIC_QUESTION_PATTERN')
    expect(source).not.toContain('routeLegacyReasoningRequest')
  })

  it('keeps tool semantics in tool descriptions instead of a pre-router', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/assistantToolsPrimary.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain('Do not substitute this for a question about one named object or its relationships.')
    expect(source).toContain('when the user asks what it emits, calls, uses, contains, triggers, produces')
  })

  it('keeps the public gateway transparent and does not rewrite model selection from message text', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/openai-assistant-v2-primary/index.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain('jetwork-primary-agent/semantic-free-v1')
    expect(source).not.toContain('JSON.parse')
    expect(source).not.toContain('parsed.model')
    expect(source).not.toContain('ENTERPRISE_')
    expect(source).not.toContain('shouldPrefer')
  })
})
