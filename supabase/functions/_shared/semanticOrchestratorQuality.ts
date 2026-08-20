import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/semanticOrchestrator.ts?quality-recovery=2'
import type { ReasoningPlan } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/reasoningEngine.ts?quality-recovery=2'
import { detectTechnicalReferenceMessageLookup } from './methodMessageRoutingQuality.ts'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/semanticOrchestrator.ts?quality-recovery=2'

const TECHNICAL_IDENTIFIER = /\b(?:Z[A-Z0-9_/-]{2,}(?:-\d+)?|CHECK_[A-Z0-9_]+)\b/giu
const EXACT_MESSAGE_CODE = /\b([A-Z][A-Z0-9_]{2,})-(\d{2,4})\b/u
const TECHNICAL_FOLLOW_UP = /^(?:teknik(?: olarak)? aç(?:ıkla|ar mısın)|teknik(?: olarak)? detaylandır|detaylandır|biraz daha detay|bunu aç|açıkla|nasıl yani|peki(?: bunun)?|neden|nasıl|hangi koşulda|koşulu ne|kodu ne|tam kod(?:u)? ver)\b/iu
const EXPLICIT_SOURCE_CODE_REQUEST = /(?:kaynak kod|source code|abap kod|implementasyon|metot kodu|method code|tam kod)/iu
const COST_TERM = /\bcost\b/iu
const COST_EVIDENCE_INTENT = /(?:hata|mesaj|uyarı|uyari|alınacak|alinacak|alınan|alinan|alırken|alirken|neler|nelerdir|liste)/iu
const ENTERPRISE_SURFACE = /(?:\bSAP\b|\bCRM\b|\bC4C\b|\bIS[- ]?U\b|\bFICA\b|\bABAP\b|\bJIRA\b|\bENERJISA\b|\bZ[A-Z0-9_]{2,}\b|\bCHECK_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9_]{2,}-\d{2,4}\b)/iu

const unique = (values: string[], limit = 12) => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit)
const currentEntities = (message: string) => unique([...message.toLocaleUpperCase('en-US').matchAll(TECHNICAL_IDENTIFIER)].map(match => match[0]), 10)
const verifiedMessageRef = (refs: string[]) => refs.find(ref => /^message:[a-z0-9_]+-\d{2,4}$/i.test(ref)) || ''
const messageCodeFromCanonical = (ref: string) => ref.replace(/^message:/i, '').toLocaleUpperCase('en-US')

const qualityPatchPlan = (plan: ReasoningPlan, input: {
  message: string
  priorExecution?: original.PriorExecutionContext
}): ReasoningPlan => {
  const message = String(input.message || '').trim()
  const exactEntities = currentEntities(message)
  const exactMessage = message.toLocaleUpperCase('en-US').match(EXACT_MESSAGE_CODE)?.[0] || ''
  const priorEntities = unique(input.priorExecution?.activeEntities || [], 10)
  const priorVerifiedRefs = unique(input.priorExecution?.verifiedFactRefs || [], 12)
  const verifiedMessage = verifiedMessageRef(priorVerifiedRefs)
  const technicalFollowUp = TECHNICAL_FOLLOW_UP.test(message) && (priorEntities.length > 0 || Boolean(verifiedMessage))
  const sourceCodeRequested = EXPLICIT_SOURCE_CODE_REQUEST.test(message)
  const costKnowledge = COST_TERM.test(message) && COST_EVIDENCE_INTENT.test(message)
  const methodMessageReference = detectTechnicalReferenceMessageLookup(message)
  const methodMessageLookup = Boolean(methodMessageReference)
  const enterpriseQuestion = exactEntities.length > 0 || ENTERPRISE_SURFACE.test(message) || technicalFollowUp || costKnowledge || methodMessageLookup

  if (!enterpriseQuestion) return plan

  const verifiedEntity = verifiedMessage ? messageCodeFromCanonical(verifiedMessage) : ''
  const activeEntities = unique([
    ...exactEntities,
    ...(technicalFollowUp ? priorEntities : []),
    ...(technicalFollowUp && verifiedEntity ? [verifiedEntity] : []),
    ...(costKnowledge ? ['ZCRM_COST'] : []),
    ...(methodMessageLookup ? [methodMessageReference] : []),
  ], 10)
  const verifiedFactRefs = unique([
    ...(plan.conversationState?.verifiedFactRefs || []),
    ...priorVerifiedRefs,
  ], 12)
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
    verifiedFactRefs,
  }

  const exactMessageLookup = Boolean(exactMessage) && !costKnowledge && !methodMessageLookup
  const verifiedMessageFollowUp = technicalFollowUp && Boolean(verifiedMessage) && !sourceCodeRequested
  const boundedExactEvidence = exactMessageLookup || verifiedMessageFollowUp
  const oneCallVerifiedEvidence = boundedExactEvidence || methodMessageLookup

  const patched: ReasoningPlan = {
    ...plan,
    intent: boundedExactEvidence ? 'analysis' : (exactEntities.length || technicalFollowUp || methodMessageLookup ? 'sap_diagnosis' : 'analysis'),
    complexity: oneCallVerifiedEvidence ? 'medium' : (plan.complexity === 'low' ? 'medium' : plan.complexity),
    executionMode: 'knowledge',
    knowledgeRequired: true,
    enterpriseGroundingRequired: true,
    verificationRequired: oneCallVerifiedEvidence ? false : true,
    webMode: 'none',
    promptProfile: 'knowledge',
    conversationState: state,
    evidenceQueries: methodMessageLookup
      ? [methodMessageReference]
      : verifiedMessageFollowUp
        ? [verifiedMessage]
        : (activeEntities.length ? activeEntities : [message]),
    // Method→message is a relation lookup, never a broad catalog enumeration.
    enumerationTarget: methodMessageLookup ? undefined : plan.enumerationTarget,
    steps: [{
      id: methodMessageLookup
        ? 'technical-reference-messages'
        : boundedExactEvidence
          ? 'exact-enterprise-detail'
          : 'enterprise-evidence-first',
      label: methodMessageLookup
        ? 'Teknik referansa bağlı doğrulanmış mesajları getir'
        : boundedExactEvidence
          ? 'Doğrulanmış kurumsal mesaj kaydını exact detail ile oku'
          : 'Kurumsal bilgi bankasındaki doğrulanmış kaydı önce kullan',
      toolHint: 'knowledge',
      successCriteria: methodMessageLookup
        ? `İlk ve tek knowledge çağrısında get_messages_by_technical_reference(technicalReference="${methodMessageReference}") kullan. Dönen citation-ready message kayıtlarının tamamını ve yalnız onları listele; genel katalog taraması yapma.`
        : boundedExactEvidence
          ? 'İlk ve tek knowledge çağrısında get_message_detail kullan. Kaynakta bulunmayan açılım, etiket, teknik nesne veya iş kuralı üretme; ZTKS gibi identifier ve kısaltmaları kaynakta açık açılım yoksa aynen bırak.'
          : 'Kullanıcıdan kaynakta bulunabilecek teknik bilgiyi istemeden exact/detail kurumsal kanıtla yanıtla. Kaynakta olmayan acronym açılımı veya identifier üretme.',
    }],
    orchestratorVersion: `${String(plan.orchestratorVersion || original.SEMANTIC_ORCHESTRATOR_VERSION)}-quality-recovery-v2-method-message-v1`,
  }

  if (methodMessageLookup) {
    patched.goal = `${methodMessageReference} teknik referansını açıkça içeren doğrulanmış message kayıtlarını get_messages_by_technical_reference ile tek çağrıda getir. Yalnız dönen mesaj kodlarını ve mesaj metinlerini ver. Genel 227 kayıt kataloğunu listeleme, prefix tahmini yapma, semantic search açma ve kaynakta olmayan mesaj ekleme.`
  } else if (costKnowledge) {
    patched.goal = 'ZCRM_COST mesajlarını kurumsal bilgi kataloğundan eksiksiz listele. Yalnız katalogda doğrulanmış kod ve mesaj metinlerini ver; kullanıcı istemedikçe skill arama, genel SAP açıklaması veya ek varsayım üretme.'
    patched.enumerationTarget = {
      tool: 'list_knowledge_catalog',
      objectType: 'message',
      prefix: 'ZCRM_COST',
      cursor: null,
    }
  } else if (verifiedMessageFollowUp) {
    patched.goal = `Doğrulanmış fact ${verifiedMessage} (${verifiedEntity}) için kullanıcının "${message}" devam sorusunu yanıtla. İlk ve tek knowledge çağrısı get_message_detail(messageCode="${verifiedEntity}") olmalı. Aynı mesajı semantic search ile tekrar arama; komşu class/function tahmini yapma. Kaynaktaki teknik referans, tetik koşulu ve kontrol noktalarını açıkla. Kaynakta olmayan acronym açılımı, alan anlamı veya teknik identifier üretme.`
  } else if (exactMessageLookup) {
    patched.goal = `${exactMessage} için ilk ve tek knowledge çağrısında get_message_detail(messageCode="${exactMessage}") kullan ve yalnız doğrulanmış mesaj metni, tetik koşulu, kontrol noktaları ve kaynakta geçen teknik referanslarla yanıtla. Kaynakta bulunmayan acronym açılımı veya teknik identifier üretme.`
  } else if (technicalFollowUp && activeEntities.length) {
    patched.goal = `${activeEntities.join(', ')} hakkında önceki kurumsal bağlamı koruyarak ${message}. Doğrulanmış kaynakları kullan; kaynakta bulunmayan acronym açılımı, identifier veya iş kuralı üretme.`
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
      quality_recovery_semantic_policy: 2,
      quality_method_message_routing: detectTechnicalReferenceMessageLookup(input.message) ? 1 : 0,
    },
  }
}
