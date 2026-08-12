import { describe, expect, it } from 'vitest'
import {
  semanticPlanFromMessage,
  type ReasoningPlan,
} from '../../../supabase/functions/_shared/reasoningEngine'
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

const semanticMessage = (message: string, plan: Record<string, unknown>) => [
  message,
  '[JETWORK_SEMANTIC_PLAN]',
  JSON.stringify(plan),
  '[END_JETWORK_SEMANTIC_PLAN]',
].join('\n')

const legacyProviderWebPlan = (resolvedRequest: string, activeEntities: string[] = []) => ({
  intent: 'simple_answer',
  complexity: 'medium',
  executionMode: 'knowledge',
  goal: `${resolvedRequest}\n[JETWORK_CAPABILITY:provider_web]`,
  knowledgeRequired: true,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  promptProfile: 'research',
  steps: [{ id: 'adaptive-evidence-loop', label: 'evidence', toolHint: 'knowledge', successCriteria: 'evidence' }],
  conversationState: {
    continuation: false,
    topic: resolvedRequest,
    userMove: 'new_request',
    operationMove: 'none',
    priorIntent: 'none',
    rejectedHypotheses: [],
    rejectedScopes: [],
    retainedContext: [],
    openQuestions: [],
    resolvedRequest,
    activeEntities,
    requestedEvidence: ['current_status'],
    userDecisions: [],
    verifiedFactRefs: [],
  },
  orchestratorVersion: 'semantic-orchestrator-v3.4-active-operation',
})

const directPlan = (resolvedRequest: string) => ({
  intent: 'simple_answer',
  complexity: 'medium',
  executionMode: 'direct',
  goal: resolvedRequest,
  knowledgeRequired: false,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [resolvedRequest],
  promptProfile: 'base',
  steps: [{ id: 'synthesize', label: 'answer', toolHint: 'synthesis', successCriteria: 'answer' }],
  conversationState: {
    continuation: false,
    topic: resolvedRequest,
    userMove: 'new_request',
    operationMove: 'none',
    priorIntent: 'none',
    rejectedHypotheses: [],
    rejectedScopes: [],
    retainedContext: [],
    openQuestions: [],
    resolvedRequest,
    activeEntities: [],
    requestedEvidence: ['user_intent'],
    userDecisions: [],
    verifiedFactRefs: [],
  },
  orchestratorVersion: 'semantic-orchestrator-v3.4-active-operation',
})

const enterprisePlan = (): ReasoningPlan => ({
  intent: 'analysis',
  complexity: 'medium',
  goal: 'CHECK_ZTKS mesajlarını doğrula',
  knowledgeRequired: true,
  enterpriseGroundingRequired: true,
  webMode: 'none',
  verificationRequired: true,
  creativeMode: false,
  evidenceQueries: ['CHECK_ZTKS'],
  steps: [],
  executionMode: 'knowledge',
})

describe('P0 assistant routing, grounding and recovery boundaries', () => {
  it('keeps canonical social language on the deterministic fast path', () => {
    expect(shouldUseTrivialAssistantFastPath({
      message: 'Nasıl gidiyor',
      model: 'gemini-3.5-flash',
      attachmentCount: 0,
    })).toBe(true)
    expect(deterministicTrivialResponseForMessage('Nasıl gidiyor')).toContain('İyi gidiyor')
  })

  it('uses the universal short-turn lane for typos, abbreviations and daily language without enumerating every phrase', () => {
    for (const message of ['Mrb', 'Nabet', 'Bok', 'Çöpleri atmayı unutma', 'Galatasaray']) {
      expect(shouldUseTrivialAssistantFastPath({
        message,
        model: 'gemini-3.1-pro-preview',
        attachmentCount: 0,
      })).toBe(true)
    }

    for (const message of ['CHECK_ZTKS', 'Galatasaray nasıl gidiyor?', 'Rapor hazırla']) {
      expect(shouldUseTrivialAssistantFastPath({
        message,
        model: 'gemini-3.1-pro-preview',
        attachmentCount: 0,
      })).toBe(false)
    }
  })

  it('never carries runtime failures into semantic memory', () => {
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

  it('does not let the semantic planner expand a bare public topic into a current-status request', () => {
    const plan = semanticPlanFromMessage(semanticMessage(
      'Galatasaray',
      legacyProviderWebPlan('Galatasaray Spor Kulübü hakkında genel bilgi ve güncel durum'),
    ))

    expect(plan).not.toBeNull()
    expect(plan?.intent).toBe('simple_answer')
    expect(plan?.complexity).toBe('low')
    expect(plan?.executionMode).toBe('direct')
    expect(plan?.knowledgeRequired).toBe(false)
    expect(plan?.enterpriseGroundingRequired).toBe(false)
    expect(plan?.webMode).toBe('none')
    expect(plan?.evidenceQueries).toEqual([])
    expect(plan?.goal).toContain('Neyi merak ettiğini')
    expect(plan?.goal).not.toContain('güncel durum')
  })

  it('does not overwrite a correct direct semantic interpretation merely because the message is short', () => {
    const plan = semanticPlanFromMessage(semanticMessage(
      'Çöpleri atmayı unutma',
      directPlan('Çöpleri atmayı unutma'),
    ))

    expect(plan).not.toBeNull()
    expect(plan?.executionMode).toBe('direct')
    expect(plan?.knowledgeRequired).toBe(false)
    expect(plan?.webMode).toBe('none')
    expect(plan?.goal).toBe('Çöpleri atmayı unutma')
    expect(plan?.conversationState?.resolvedRequest).toBe('Çöpleri atmayı unutma')
    expect(plan?.orchestratorVersion).not.toContain('bare-topic-safety')
  })

  it('repairs legacy Gemini provider-web encoding into public web without enterprise RAG', () => {
    const plan = semanticPlanFromMessage(semanticMessage(
      'Galatasaray nasıl gidiyor?',
      legacyProviderWebPlan("Galatasaray Spor Kulübü'nün güncel durumu ve performansı hakkında bilgi."),
    ))

    expect(plan).not.toBeNull()
    expect(plan?.knowledgeRequired).toBe(false)
    expect(plan?.enterpriseGroundingRequired).toBe(false)
    expect(plan?.webMode).toBe('required')
    expect(plan?.evidenceQueries).toEqual([])
    expect(plan?.goal).not.toContain('JETWORK_CAPABILITY')
  })

  it('uses a universal persona for public/direct turns and preserves the enterprise persona only for grounded enterprise work', () => {
    const configured = [
      "Sen Enerjisa IT'de çalışan kıdemli bir İş Analistisin.",
      'Her yeni talebi içeride Proje veya Support olarak değerlendir.',
      '[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]',
      'Teknik identifierları kaynaktan doğrula.',
    ].join('\n')

    const publicPlan: ReasoningPlan = {
      intent: 'simple_answer', complexity: 'low', goal: 'gündelik sohbet',
      knowledgeRequired: false, enterpriseGroundingRequired: false, webMode: 'none',
      verificationRequired: false, creativeMode: false, evidenceQueries: [], steps: [], executionMode: 'direct',
    }
    const publicPrompt = composeAssistantPrompt(configured, publicPlan)
    expect(requiresEnterpriseAssistantPersona(publicPlan)).toBe(false)
    expect(publicPrompt).toContain('Sen JetWork AI asistanısın')
    expect(publicPrompt).not.toContain('Enerjisa IT')
    expect(publicPrompt).not.toContain('Proje veya Support')

    const technicalPlan = enterprisePlan()
    const enterprisePrompt = composeAssistantPrompt(configured, technicalPlan)
    expect(requiresEnterpriseAssistantPersona(technicalPlan)).toBe(true)
    expect(enterprisePrompt).toContain('Enerjisa IT')
    expect(enterprisePrompt).toContain('EXACT TECHNICAL EVIDENCE')
  })

  it('keeps technical enterprise plans fail-closed even when a provider-web marker exists', () => {
    const plan = semanticPlanFromMessage(semanticMessage('CHECK_ZTKS hangi mesajları üretiyor?', {
      ...legacyProviderWebPlan('CHECK_ZTKS hata mesajlarını kurumsal kaynaktan doğrula', ['CHECK_ZTKS']),
      intent: 'sap_diagnosis',
      verificationRequired: true,
    }))

    expect(plan).not.toBeNull()
    expect(plan?.knowledgeRequired).toBe(true)
    expect(plan?.enterpriseGroundingRequired).toBe(true)
    expect(plan?.webMode).toBe('if_internal_insufficient')
  })

  it('never accepts a public web URL as enterprise grounding evidence', () => {
    const webOnly = evaluateGroundedTechnicalClaims({
      text: 'CHECK_ZTKS bu kontrolü yapar.',
      plan: enterprisePlan(),
      sources: [{ sourceType: 'web', url: 'https://example.com', sourceId: 'web-1' }],
      toolResults: [],
    })
    expect(webOnly.ok).toBe(false)
    expect(shouldFailClosedGroundedAnswer({ plan: enterprisePlan(), coverage: webOnly })).toBe(true)

    const internal = evaluateGroundedTechnicalClaims({
      text: 'CHECK_ZTKS bu kontrolü yapar.',
      plan: enterprisePlan(),
      sources: [{ sourceType: 'knowledge', canonicalKey: 'method:CHECK_ZTKS', sourceId: 'kb-1' }],
      toolResults: [],
    })
    expect(internal.ok).toBe(true)
  })

  it('does not fail-close a public answer merely because there is no enterprise evidence', () => {
    const publicPlan: ReasoningPlan = {
      intent: 'research',
      complexity: 'medium',
      goal: 'Galatasaray güncel durum',
      knowledgeRequired: false,
      enterpriseGroundingRequired: false,
      webMode: 'required',
      verificationRequired: false,
      creativeMode: false,
      evidenceQueries: [],
      steps: [],
      executionMode: 'research',
    }
    const coverage = evaluateGroundedTechnicalClaims({
      text: 'Public answer',
      plan: publicPlan,
      sources: [],
      toolResults: [],
    })
    expect(coverage.ok).toBe(true)
    expect(shouldFailClosedGroundedAnswer({ plan: publicPlan, coverage })).toBe(false)
  })
})
