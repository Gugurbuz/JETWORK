import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/semanticOrchestrator.ts?quality-recovery=1'
import type { ReasoningPlan } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/reasoningEngine.ts?quality-recovery=1'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/semanticOrchestrator.ts?quality-recovery=1'

const TECHNICAL_IDENTIFIER = /\b(?:Z[A-Z0-9_/-]{2,}(?:-\d+)?|CHECK_[A-Z0-9_]+)\b/giu
const TECHNICAL_FOLLOW_UP = /^(?:teknik(?: olarak)? aç(?:ıkla|ar mısın)|teknik(?: olarak)? detaylandır|detaylandır|biraz daha detay|bunu aç|açıkla|nasıl yani|peki(?: bunun)?|neden|nasıl|hangi koşulda|koşulu ne|kodu ne|tam kod(?:u)? ver)\b/iu
const COST_TERM = /\bcost\b/iu
const COST_EVIDENCE_INTENT = /(?:hata|mesaj|uyarı|uyari|alınacak|alinacak|alınan|alinan|alırken|alirken|neler|nelerdir|liste)/iu
const ENTERPRISE_SURFACE = /(?:\bSAP\b|\bCRM\b|\bC4C\b|\bIS[- ]?U\b|\bFICA\b|\bABAP\b|\bJIRA\b|\bENERJISA\b|\bZ[A-Z0-9_]{2,}\b|\bCHECK_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9_]{2,}-\d{2,4}\b)/iu

const unique = (values: string[], limit = 12) => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit)
const currentEntities = (message: string) => unique([...message.toLocaleUpperCase('en-US').matchAll(TECHNICAL_IDENTIFIER)].map(match => match[0]), 10)

const qualityPatchPlan = (plan: ReasoningPlan, input: {
  message: string
  priorExecution?: original.PriorExecutionContext
}): ReasoningPlan => {
  const message = String(input.message || '').trim()
  const exactEntities = currentEntities(message)
  const priorEntities = unique(input.priorExecution?.activeEntities || [], 10)
  const technicalFollowUp = TECHNICAL_FOLLOW_UP.test(message) && priorEntities.length > 0
  const costKnowledge = COST_TERM.test(message) && COST_EVIDENCE_INTENT.test(message)
  const enterpriseQuestion = exactEntities.length > 0 || ENTERPRISE_SURFACE.test(message) || technicalFollowUp || costKnowledge

  if (!enterpriseQuestion) return plan

  const activeEntities = unique([
    ...exactEntities,
    ...(technicalFollowUp ? priorEntities : []),
    ...(costKnowledge ? ['ZCRM_COST'] : []),
  ], 10)
  const state = {
    ...(plan.conversationState || {
      continuation: false,
      topic: message,
      userMove: 'new_request' as const,
      priorIntent: 'none' as const,
      rejectedHypotheses: [],
      retainedContext: [],
      openQuestions: [],
    }),
    continuation: technicalFollowUp || Boolean(plan.conversationState?.continuation),
    userMove: technicalFollowUp ? 'follow_up' as const : (plan.conversationState?.userMove || 'new_request' as const),
    topic: activeEntities[0] || plan.conversationState?.topic || message,
    activeEntities,
    resolvedRequest: technicalFollowUp && activeEntities.length
      ? `${activeEntities.join(', ')} — ${message}`
      : message,
    verifiedFactRefs: unique([
      ...(plan.conversationState?.verifiedFactRefs || []),
      ...(input.priorExecution?.verifiedFactRefs || []),
    ], 12),
  }

  const patched: ReasoningPlan = {
    ...plan,
    intent: exactEntities.length || technicalFollowUp ? 'sap_diagnosis' : 'analysis',
    complexity: plan.complexity === 'low' ? 'medium' : plan.complexity,
    executionMode: 'knowledge',
    knowledgeRequired: true,
    enterpriseGroundingRequired: true,
    verificationRequired: true,
    webMode: 'none',
    promptProfile: 'knowledge',
    conversationState: state,
    evidenceQueries: activeEntities.length ? activeEntities : [message],
    steps: [{
      id: 'enterprise-evidence-first',
      label: 'Kurumsal bilgi bankasındaki doğrulanmış kaydı önce kullan',
      toolHint: 'knowledge',
      successCriteria: 'Kullanıcıdan kaynakta bulunabilecek teknik bilgiyi istemeden exact/detail kurumsal kanıtla yanıtla.',
    }],
    orchestratorVersion: `${String(plan.orchestratorVersion || original.SEMANTIC_ORCHESTRATOR_VERSION)}-quality-recovery-v1`,
  }

  if (costKnowledge) {
    patched.goal = 'ZCRM_COST mesajlarını kurumsal bilgi kataloğundan listele; kullanıcının istediği kapsamda hata kodu, mesaj ve doğrulanmış koşulları ver.'
    patched.enumerationTarget = {
      tool: 'list_knowledge_catalog',
      objectType: 'message',
      prefix: 'ZCRM_COST',
      cursor: null,
    }
  } else if (technicalFollowUp && activeEntities.length) {
    patched.goal = `${activeEntities.join(', ')} hakkında önceki kurumsal bağlamı koruyarak ${message}. Exact/detail kaynakları yeniden kullan ve doğrulanmış teknik sınırı açıkça ayır.`
  }

  return patched
}

export const normalizeCachedSemanticPlan = (input: Parameters<typeof original.normalizeCachedSemanticPlan>[0]): ReasoningPlan | null => {
  const plan = original.normalizeCachedSemanticPlan(input)
  return plan ? qualityPatchPlan(plan, { message: input.currentMessage, priorExecution: input.priorExecution }) : null
}

export async function buildSemanticExecutionPlan(
  input: Parameters<typeof original.buildSemanticExecutionPlan>[0],
): Promise<original.SemanticOrchestrationResult> {
  const result = await original.buildSemanticExecutionPlan(input)
  return {
    ...result,
    plan: qualityPatchPlan(result.plan, { message: input.message, priorExecution: input.priorExecution }),
    usage: {
      ...(result.usage || {}),
      quality_recovery_semantic_policy: 1,
    },
  }
}
