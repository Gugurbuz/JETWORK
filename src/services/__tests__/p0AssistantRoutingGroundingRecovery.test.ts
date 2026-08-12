import { describe, expect, it } from 'vitest'
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator'
import {
  evaluateGroundedTechnicalClaims,
  shouldFailClosedGroundedAnswer,
} from '../../../supabase/functions/_shared/groundingGuard'
import {
  deterministicTrivialResponseForMessage,
  shouldUseTrivialAssistantFastPath,
} from '../../../supabase/functions/_shared/trivialAssistantFastPath'
import {
  compactAssistantConversationMemory,
  isAssistantOperationalErrorText,
} from '../../../supabase/functions/_shared/conversationMemory'
import {
  composeAssistantPrompt,
  requiresEnterpriseAssistantPersona,
} from '../../../supabase/functions/_shared/assistantPromptProfiles'

const primaryPlan = async (message: string) => (
  await buildSemanticExecutionPlan({
    provider: 'gemini',
    model: 'gemini-3.1-pro-preview',
    message,
    conversation: [],
  })
)

const strictPlan = (): ReasoningPlan => ({
  intent: 'sap_diagnosis',
  complexity: 'medium',
  goal: 'CHECK_ZTKS mesajlarını doğrula',
  knowledgeRequired: true,
  enterpriseGroundingRequired: true,
  webMode: 'none',
  verificationRequired: true,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  executionMode: 'knowledge',
})

describe('P0 primary LLM agent boundaries', () => {
  it('keeps Selam and canonical social language on the deterministic fast path', () => {
    expect(shouldUseTrivialAssistantFastPath({
      message: 'Selam',
      model: 'gemini-3.5-flash',
      attachmentCount: 0,
    })).toBe(true)
    expect(deterministicTrivialResponseForMessage('Selam')).toContain('Nasıl yardımcı olabilirim')
  })

  it('keeps real tasks and ambiguous short text out of the context-free fast path', () => {
    for (const message of [
      'Mrb',
      'Nabet',
      'Galatasaray',
      'Uçak reservasyon sürecini analzi ey',
      'Su abonelik sürecini analiz et',
      'Satış sürecini analiz et',
      'CHECK_ZTKS',
    ]) {
      expect(shouldUseTrivialAssistantFastPath({
        message,
        model: 'gemini-3.1-pro-preview',
        attachmentCount: 0,
      })).toBe(false)
    }
  })

  it('does not preflight RAG, web verification or strict grounding for water-subscription analysis', async () => {
    const result = await primaryPlan('Su abonelik sürecini analiz et')
    const plan = result.plan

    expect(plan.intent).toBe('analysis')
    expect(plan.executionMode).toBe('direct')
    expect(plan.enterpriseGroundingRequired).toBe(false)
    expect(plan.verificationRequired).toBe(false)
    expect(plan.evidenceQueries).toEqual([])
    expect(plan.orchestratorVersion).toBe('primary-llm-agent-v1')
    // Transitional compatibility flag: knowledge capability is exposed to the
    // primary model, but empty evidenceQueries means no mandatory preflight RAG.
    expect(plan.knowledgeRequired).toBe(true)
    expect(result.usage?.semantic_planner_provider_calls_avoided).toBe(1)
  })

  it('makes workspace knowledge available for sales analysis without making missing sources fatal', async () => {
    const result = await primaryPlan('Satış sürecini analiz et')
    const plan = result.plan

    expect(plan.intent).toBe('analysis')
    expect(plan.executionMode).toBe('direct')
    expect(plan.knowledgeRequired).toBe(true)
    expect(plan.enterpriseGroundingRequired).toBe(false)
    expect(plan.verificationRequired).toBe(false)
    expect(plan.evidenceQueries).toEqual([])

    const coverage = evaluateGroundedTechnicalClaims({
      text: 'Satış sürecini müşteri ihtiyacının alınması, teklif, müzakere ve kapanış gibi aşamalar üzerinden değerlendirebiliriz.',
      plan,
      sources: [],
      toolResults: [],
    })
    expect(coverage.ok).toBe(true)
    expect(shouldFailClosedGroundedAnswer({ plan, coverage })).toBe(false)
  })

  it('grounds CHECK_ZTKS at the response boundary even when the planner did not pre-mark the turn strict', async () => {
    const result = await primaryPlan('CHECK_ZTKS hangi mesajları üretiyor?')
    expect(result.plan.enterpriseGroundingRequired).toBe(false)
    expect(result.plan.evidenceQueries).toEqual([])

    const unverified = evaluateGroundedTechnicalClaims({
      text: 'CHECK_ZTKS bu kontrolü yapar.',
      plan: result.plan,
      sources: [],
      toolResults: [],
    })
    expect(unverified.ok).toBe(false)
    expect(shouldFailClosedGroundedAnswer({ plan: result.plan, coverage: unverified })).toBe(true)

    const verified = evaluateGroundedTechnicalClaims({
      text: 'CHECK_ZTKS bu kontrolü yapar.',
      plan: result.plan,
      sources: [{ sourceType: 'knowledge', canonicalKey: 'method:CHECK_ZTKS', sourceId: 'kb-1' }],
      toolResults: [],
    })
    expect(verified.ok).toBe(true)
  })

  it('never accepts a public web URL as enterprise grounding evidence', () => {
    const plan = strictPlan()
    const webOnly = evaluateGroundedTechnicalClaims({
      text: 'CHECK_ZTKS bu kontrolü yapar.',
      plan,
      sources: [{ sourceType: 'web', url: 'https://example.com', sourceId: 'web-1' }],
      toolResults: [],
    })
    expect(webOnly.ok).toBe(false)
    expect(shouldFailClosedGroundedAnswer({ plan, coverage: webOnly })).toBe(true)
  })

  it('does not let optional knowledge capability activate the Enerjisa persona or exact contract', async () => {
    const configured = [
      "Sen Enerjisa IT'de çalışan kıdemli bir İş Analistisin.",
      'Her yeni talebi içeride Proje veya Support olarak değerlendir.',
      '[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]',
      'Teknik identifierları kaynaktan doğrula.',
    ].join('\n')
    const plan = (await primaryPlan('Satış sürecini analiz et')).plan
    const prompt = composeAssistantPrompt(configured, plan)

    expect(requiresEnterpriseAssistantPersona(plan)).toBe(false)
    expect(prompt).toContain('Sen JetWork AI asistanısın')
    expect(prompt).toContain('Bu turnün ana karar vericisi sensin')
    expect(prompt).not.toContain('Enerjisa IT')
    expect(prompt).not.toContain('Proje veya Support')
    expect(prompt).not.toContain('EXACT TECHNICAL EVIDENCE')
  })

  it('never carries runtime failures into durable conversational memory', () => {
    const failures = [
      'Load failed Lütfen tekrar deneyin.',
      'Bu çalışma alanında başka bir yanıt hâlâ hazırlanıyor. Lütfen tekrar deneyin.',
      'Bu teknik yanıtı güvenli biçimde tamamlayamadım: üretilen taslakta kanıt yoktu.',
      'Önceki yanıt yeni talep nedeniyle iptal edildi.',
    ]
    for (const failure of failures) {
      expect(isAssistantOperationalErrorText(failure)).toBe(true)
      expect(compactAssistantConversationMemory(failure)).toBe('')
    }
  })
})
