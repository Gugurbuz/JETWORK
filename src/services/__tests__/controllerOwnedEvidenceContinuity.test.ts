import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildResolvedConversationInstruction } from '../../../supabase/functions/_shared/resolvedConversationContext'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator'

const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const policySource = readFileSync(new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url), 'utf8')

describe('controller-owned evidence continuity', () => {
  it('removes runtime semantic grounding from the live final-answer path', () => {
    expect(coreSource).not.toContain('RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED')
    expect(coreSource).not.toContain('evaluateGroundedTechnicalClaims')
    expect(coreSource).not.toContain('shouldFailClosedGroundedAnswer')
    expect(coreSource).not.toContain('groundingFailureText')
    expect(coreSource).not.toContain('[GROUNDING_REPAIR_OBSERVATION]')
    expect(coreSource).not.toContain('grounding_fail_closed')
    expect(coreSource).toContain('semanticGroundingGate: false')
    expect(policySource).toContain('Runtime doğal dil iddialarını regex')
  })

  it('exposes prior verified refs as rehydratable provenance, not as hidden semantic routing', () => {
    const instruction = buildResolvedConversationInstruction({
      resolvedRequest: 'Enerjisa LRT detayını açıklamak',
      activeEntities: ['LRT'],
      verifiedFactRefs: ['method:unscoped_class/check_lrtv3'],
    })
    expect(instruction).toContain('method:unscoped_class/check_lrtv3')
    expect(instruction).toContain('evidence provenance refleri')
    expect(instruction).toContain('yeniden açılabilir başlangıç noktaları')
    expect(policySource).toContain('canonical reflerin hedef için hâlâ anlamlı olup olmadığını değerlendir')
  })

  it('carries CHECK_LRTV3 provenance into an Enerjisa follow-up resolved state', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      message: 'Enerjisadaki detayı nedir',
      conversation: [
        { role: 'user', content: 'Lrt ne demek' },
        { role: 'assistant', content: 'LRT için Enerjisa ve CHECK_LRTV3 bağlamını araştırdım.' },
      ],
      priorExecution: {
        intent: 'analysis',
        complexity: 'medium',
        knowledgeUsed: true,
        resolvedRequest: 'LRT kısaltmasının Enerjisa bağlamındaki anlamını doğrulamak',
        activeEntities: ['LRT'],
        verifiedFactRefs: ['method:unscoped_class/check_lrtv3'],
      },
    })

    expect(result.plan.conversationState?.verifiedFactRefs).toContain('method:unscoped_class/check_lrtv3')
    expect(result.plan.conversationState?.resolvedRequest || result.plan.goal).toMatch(/LRT|Enerjisa/i)
  })
})
