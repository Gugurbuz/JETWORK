import { describe, expect, it } from 'vitest'
import {
  buildSemanticExecutionPlan,
  normalizeCachedSemanticPlan,
} from '../../../supabase/functions/_shared/semanticOrchestrator'

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

  it('treats approval/start wording as a continuation of the active task', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      message: 'onaylıyorum başla',
      conversation: [],
      priorExecution: {
        intent: 'project',
        resolvedRequest: 'JetWork kalite runtime refactorunu tamamla ve CI doğrula',
      },
    })

    expect(result.plan.conversationState?.continuation).toBe(true)
    expect(result.plan.conversationState?.resolvedRequest).toContain('JetWork kalite runtime refactorunu tamamla')
    expect(result.plan.conversationState?.resolvedRequest).toContain('onaylıyorum başla')
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

  it('does not resurrect stale positive decisions from a cached semantic plan', () => {
    const cached = {
      intent: 'analysis',
      complexity: 'medium',
      executionMode: 'direct',
      goal: 'Qwen grammar düzelt',
      knowledgeRequired: false,
      enterpriseGroundingRequired: false,
      webMode: 'none',
      verificationRequired: false,
      creativeMode: false,
      evidenceQueries: [],
      promptProfile: 'base',
      steps: [],
      conversationState: {
        continuation: true,
        topic: 'Qwen',
        userMove: 'follow_up',
        operationMove: 'none',
        priorIntent: 'analysis',
        rejectedHypotheses: ['eski yanlış hipotez'],
        rejectedScopes: ['eski reddedilmiş kapsam'],
        retainedContext: ['assistant: Qwen üzerinde çalışıyoruz'],
        openQuestions: ['Qwen grammar nasıl düzeltilecek?'],
        resolvedRequest: 'Qwen grammar düzelt',
        activeEntities: ['QWEN'],
        requestedEvidence: ['qwen_runtime'],
        userDecisions: ['Qwen ile devam'],
        verifiedFactRefs: ['QWEN'],
      },
      orchestratorVersion: 'primary-llm-agent-v1',
    }

    const result = normalizeCachedSemanticPlan({
      value: cached,
      currentMessage: 'hayır qwen değil kalite konuşuyoruz',
      conversation: [{ role: 'assistant', content: 'Qwen grammar düzeltmesine geçiyorum.' }],
      priorExecution: {
        intent: 'analysis',
        resolvedRequest: 'JetWork kalite ve conversation context runtime geliştirmelerini tamamla',
        projectMemory: [{
          key: 'constraint.quality',
          value: 'Kalite düşmeden context küçültülecek.',
          category: 'constraint',
          confidence: 1,
          sourceType: 'user_message',
          version: 2,
        }],
      },
    })

    const state = result?.conversationState
    expect(state?.resolvedRequest).toContain('JetWork kalite ve conversation context runtime')
    expect(state?.userDecisions).toContain('constraint.quality: Kalite düşmeden context küçültülecek.')
    expect(state?.userDecisions?.join(' ')).not.toContain('Qwen ile devam')
    expect(state?.activeEntities || []).not.toContain('QWEN')
    expect(state?.requestedEvidence || []).not.toContain('qwen_runtime')
    expect(state?.retainedContext?.join(' ') || '').not.toContain('Qwen üzerinde çalışıyoruz')
    expect(state?.rejectedScopes).toContain('eski reddedilmiş kapsam')
  })
})