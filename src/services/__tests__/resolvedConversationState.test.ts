import { describe, expect, it } from 'vitest'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator'

describe('resolved conversation state continuity', () => {
  it('resolves a generic short continuation from the prior completed task', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      message: 'tamam devam et',
      conversation: [],
      priorExecution: {
        intent: 'analysis',
        resolvedRequest: 'JetWork kalite ve conversation context runtime geliştirmelerini tamamla',
        requestedEvidence: ['runtime_contract'],
      },
    })

    expect(result.plan.conversationState?.continuation).toBe(true)
    expect(result.plan.conversationState?.resolvedRequest).toContain('JetWork kalite ve conversation context runtime geliştirmelerini tamamla')
    expect(result.plan.conversationState?.resolvedRequest).toContain('tamam devam et')
    expect(result.plan.conversationState?.topic).not.toBe('tamam devam et')
    expect(result.plan.conversationState?.requestedEvidence).toContain('runtime_contract')
  })

  it('keeps corrections attached to the prior task instead of creating a disconnected topic', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      message: 'hayır Qwen değil kalite',
      conversation: [
        { role: 'assistant', content: 'Qwen tool grammar düzeltmesine devam edeceğim.' },
      ],
      priorExecution: {
        intent: 'analysis',
        resolvedRequest: 'JetWork asistan kalite runtime planını tamamla',
      },
    })

    expect(result.plan.conversationState?.continuation).toBe(true)
    expect(result.plan.conversationState?.userMove).toBe('rejection')
    expect(result.plan.conversationState?.resolvedRequest).toContain('JetWork asistan kalite runtime planını tamamla')
    expect(result.plan.conversationState?.resolvedRequest).toContain('hayır Qwen değil kalite')
    expect(result.plan.conversationState?.rejectedHypotheses?.join(' ')).toContain('Qwen tool grammar')
  })

  it('does not force a substantive new request into the previous task', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      message: 'Yeni bir müşteri portalı için sıfırdan mobil onboarding mimarisi tasarla ve risklerini çıkar',
      conversation: [],
      priorExecution: {
        intent: 'analysis',
        resolvedRequest: 'JetWork kalite runtime geliştirmelerini tamamla',
      },
    })

    expect(result.plan.conversationState?.continuation).toBe(false)
    expect(result.plan.conversationState?.resolvedRequest).toContain('Yeni bir müşteri portalı')
    expect(result.plan.conversationState?.resolvedRequest).not.toContain('JetWork kalite runtime')
  })
})
