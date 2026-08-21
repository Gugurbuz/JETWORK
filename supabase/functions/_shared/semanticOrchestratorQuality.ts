import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/semanticOrchestrator.ts?quality-recovery=2'
import type { ReasoningPlan } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/reasoningEngine.ts?quality-recovery=2'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/semanticOrchestrator.ts?quality-recovery=2'

const TECHNICAL_IDENTIFIER = /\b(?:Z[A-Z0-9_/-]{2,}(?:-\d+)?|CHECK_[A-Z0-9_]+)\b/giu
const EXACT_MESSAGE_CODE = /\b([A-Z][A-Z0-9_]{2,})-(\d{2,4})\b/u
const TECHNICAL_FOLLOW_UP = /^(?:teknik(?: olarak)? aç(?:ıkla|ar mısın)|teknik(?: olarak)? detaylandır|detaylandır|biraz daha detay|bunu aç|açıkla|nasıl yani|peki(?: bunun)?|neden|nasıl|hangi koşulda|koşulu ne|kodu ne|tam kod(?:u)? ver)\b/iu
const ELLIPTICAL_FOLLOW_UP = /^(?:hepsi|hepsini|tümü|tümünü|tamamı|diğerleri|bunlar|onlar|hangileri|peki|neden|nasıl|devam|devamını|kalan|gerisi|all|the rest)\b/iu
const EXPLICIT_SOURCE_CODE_REQUEST = /(?:kaynak kod|source code|abap kod|implementasyon|metot kodu|method code|tam kod)/iu
const COST_TERM = /\bcost\b/iu
const COST_EVIDENCE_INTENT = /(?:hata|mesaj|uyarı|uyari|alınacak|alinacak|alınan|alinan|alırken|alirken|neler|nelerdir|liste)/iu
const ENTERPRISE_SURFACE = /(?:\bSAP\b|\bCRM\b|\bC4C\b|\bIS[- ]?U\b|\bFICA\b|\bABAP\b|\bJIRA\b|\bENERJISA\b|\bZ[A-Z0-9_]{2,}\b|\bCHECK_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9_]{2,}-\d{2,4}\b)/iu
const CASUAL_CHAT = /^(?:selam|merhaba|hey|nasılsın|naber|ne haber|nasıl gidiyor|iyi misin|günaydın|iyi geceler|teşekkür|teşekkürler|sağ ol|saol|eyvallah)(?:\b|$)/iu
const INFORMATION_SEEKING = /\b(?:ne|nedir|neler|hangi|hangileri|neden|niye|nasıl|kim|nerede|ne zaman|kaç|listele|liste|göster|açıkla|anlat|bul|bak|kontrol|incele|analiz|hata|kod|kural|süreç|metot|method|fonksiyon|servis|ürün|müşteri|satış|teklif|sözleşme|maliyet|hesaplama|what|which|why|how|who|where|when|list|show|explain|find|check|analyze|error|code|rule|process|function|service|product|customer|sales|offer|contract|cost|calculation)\b/iu
const STRUCTURED_REQUIREMENT_NUMBER = /^\s*\d+(?:\.\d+){1,}\s+/gmu
const STRUCTURED_REQUIREMENT_LANGUAGE = /\b(?:gereksinim[a-zçğıöşü]*|iş kuralı|servis[a-zçğıöşü]* güncellen[a-zçğıöşü]*|güncellenmelidir|olacaktır|dönmelidir|yapılmalıdır|mevcutta|proje ile|senaryo)\b/giu

const unique = (values: string[], limit = 12) => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit)
const currentEntities = (message: string) => unique([...message.toLocaleUpperCase('en-US').matchAll(TECHNICAL_IDENTIFIER)].map(match => match[0]), 10)
const verifiedMessageRef = (refs: string[]) => refs.find(ref => /^message:[a-z0-9_]+-\d{2,4}$/i.test(ref)) || ''
const messageCodeFromCanonical = (ref: string) => ref.replace(/^message:/i, '').toLocaleUpperCase('en-US')
const looksLikeUserProvidedRequirements = (message: string) => {
  const numberedItems = message.match(STRUCTURED_REQUIREMENT_NUMBER)?.length || 0
  const requirementSignals = message.match(STRUCTURED_REQUIREMENT_LANGUAGE)?.length || 0
  return message.trim().length >= 350 && (numberedItems >= 2 || requirementSignals >= 3)
}
const priorMeaningfulUserRequest = (conversation: Array<{ role: string; content: string }> = []) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const item = conversation[index]
    if (item?.role !== 'user') continue
    const content = String(item.content || '').trim().slice(0, 1_200)
    if (!content || ELLIPTICAL_FOLLOW_UP.test(content)) continue
    return content
  }
  return ''
}

const qualityPatchPlan = (plan: ReasoningPlan, input: {
  message: string
  priorExecution?: original.PriorExecutionContext
  conversation?: Array<{ role: string; content: string }>
}): ReasoningPlan => {
  const message = String(input.message || '').trim()
  const exactEntities = currentEntities(message)
  const exactMessage = message.toLocaleUpperCase('en-US').match(EXACT_MESSAGE_CODE)?.[0] || ''
  const priorEntities = unique(input.priorExecution?.activeEntities || [], 10)
  const priorVerifiedRefs = unique(input.priorExecution?.verifiedFactRefs || [], 12)
  const verifiedMessage = verifiedMessageRef(priorVerifiedRefs)
  const priorRequest = priorMeaningfulUserRequest(input.conversation)
  const contextualFollowUp = ELLIPTICAL_FOLLOW_UP.test(message) && Boolean(priorRequest || priorEntities.length || verifiedMessage)
  const technicalFollowUp = TECHNICAL_FOLLOW_UP.test(message) && (priorEntities.length > 0 || Boolean(verifiedMessage))
  const sourceCodeRequested = EXPLICIT_SOURCE_CODE_REQUEST.test(message)
  const costKnowledge = COST_TERM.test(message) && COST_EVIDENCE_INTENT.test(message)
  const strictEnterpriseQuestion = exactEntities.length > 0 || technicalFollowUp || costKnowledge
  const genericKnowledgeDiscovery = !looksLikeUserProvidedRequirements(message)
    && !CASUAL_CHAT.test(message)
    && (contextualFollowUp || ENTERPRISE_SURFACE.test(message) || INFORMATION_SEEKING.test(message))
  const enterpriseQuestion = strictEnterpriseQuestion || genericKnowledgeDiscovery

  if (!enterpriseQuestion) return plan

  const verifiedEntity = verifiedMessage ? messageCodeFromCanonical(verifiedMessage) : ''
  const activeEntities = unique([
    ...exactEntities,
    ...(technicalFollowUp ? priorEntities : []),
    ...(technicalFollowUp && verifiedEntity ? [verifiedEntity] : []),
    ...(costKnowledge ? ['ZCRM_COST'] : []),
  ], 10)
  const verifiedFactRefs = unique([
    ...(plan.conversationState?.verifiedFactRefs || []),
    ...priorVerifiedRefs,
  ], 12)
  const resolvedRequest = contextualFollowUp && priorRequest
    ? `${priorRequest}\nTakip talebi: ${message}`
    : technicalFollowUp && activeEntities.length
      ? `${activeEntities.join(', ')} — ${message}`
      : message
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
    continuation: contextualFollowUp || technicalFollowUp || Boolean(plan.conversationState?.continuation),
    userMove: contextualFollowUp || technicalFollowUp ? 'follow_up' as const : (plan.conversationState?.userMove || 'new_request' as const),
    topic: activeEntities[0] || (contextualFollowUp && priorRequest ? priorRequest : plan.conversationState?.topic || message),
    activeEntities,
    resolvedRequest,
    verifiedFactRefs,
  }

  const exactMessageLookup = Boolean(exactMessage) && !costKnowledge
  const verifiedMessageFollowUp = technicalFollowUp && Boolean(verifiedMessage) && !sourceCodeRequested
  const boundedExactEvidence = exactMessageLookup || verifiedMessageFollowUp

  if (!strictEnterpriseQuestion && genericKnowledgeDiscovery) {
    return {
      ...plan,
      intent: plan.intent === 'simple_answer' ? 'analysis' : plan.intent,
      complexity: plan.complexity,
      executionMode: 'knowledge',
      knowledgeRequired: true,
      enterpriseGroundingRequired: false,
      verificationRequired: false,
      webMode: plan.webMode,
      promptProfile: 'knowledge',
      conversationState: state,
      evidenceQueries: unique([resolvedRequest, message], 2),
      steps: [{
        id: 'enterprise-knowledge-discovery',
        label: 'JetWork Global + proje bilgi bankasında ilgili kaynağı keşfet',
        toolHint: 'knowledge',
        successCriteria: 'İlgili kurumsal kaynak varsa kullan. Boş veya zayıf retrieval sonucunu bilgi bankasında kayıt yok kanıtı sayma; cevap gereksiz yere bloke edilmesin.',
      }],
      goal: [
        resolvedRequest,
        '[JETWORK_KNOWLEDGE_DISCOVERY] Bu talep için JetWork Global + proje bilgi bankasında ilgili kaynak varsa kullan. Bu keşif zorunlu grounding değildir. Arama boş veya yetersiz dönerse "bilgi bankasında yok" sonucuna varma; yalnız bu aramada doğrulanmış ilgili kaynak bulunamadığını belirt ve doğrulanmamış kurum özeli uydurmadan normal reasoning ile devam et.',
      ].join('\n'),
      orchestratorVersion: `${String(plan.orchestratorVersion || original.SEMANTIC_ORCHESTRATOR_VERSION)}-quality-recovery-v3`,
    }
  }

  const patched: ReasoningPlan = {
    ...plan,
    intent: boundedExactEvidence ? 'analysis' : (exactEntities.length || technicalFollowUp ? 'sap_diagnosis' : 'analysis'),
    complexity: boundedExactEvidence ? 'medium' : (plan.complexity === 'low' ? 'medium' : plan.complexity),
    executionMode: 'knowledge',
    knowledgeRequired: true,
    enterpriseGroundingRequired: true,
    // Exact/identifier-bound enterprise questions remain authoritative. General
    // natural-language questions use the non-blocking discovery path above.
    verificationRequired: boundedExactEvidence ? false : true,
    webMode: 'none',
    promptProfile: 'knowledge',
    conversationState: state,
    evidenceQueries: verifiedMessageFollowUp
      ? [verifiedMessage]
      : (activeEntities.length ? activeEntities : [resolvedRequest]),
    steps: [{
      id: boundedExactEvidence ? 'exact-enterprise-detail' : 'enterprise-evidence-first',
      label: boundedExactEvidence
        ? 'Doğrulanmış kurumsal mesaj kaydını exact detail ile oku'
        : 'Kurumsal bilgi bankasındaki doğrulanmış kaydı önce kullan',
      toolHint: 'knowledge',
      successCriteria: boundedExactEvidence
        ? 'İlk ve tek knowledge çağrısında get_message_detail kullan. Kaynakta bulunmayan açılım, etiket, teknik nesne veya iş kuralı üretme; ZTKS gibi identifier ve kısaltmaları kaynakta açık açılım yoksa aynen bırak.'
        : 'Kullanıcıdan kaynakta bulunabilecek teknik bilgiyi istemeden exact/detail kurumsal kanıtla yanıtla. Kaynakta olmayan acronym açılımı veya identifier üretme.',
    }],
    orchestratorVersion: `${String(plan.orchestratorVersion || original.SEMANTIC_ORCHESTRATOR_VERSION)}-quality-recovery-v3`,
  }

  if (costKnowledge) {
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
  return plan ? qualityPatchPlan(plan, {
    message: input.currentMessage,
    priorExecution: input.priorExecution,
    conversation: input.conversation,
  }) : null
}

export async function buildSemanticExecutionPlan(
  input: Parameters<typeof original.buildSemanticExecutionPlan>[0],
): Promise<original.SemanticOrchestrationResult> {
  const result = await original.buildSemanticExecutionPlan(input)
  return {
    ...result,
    plan: qualityPatchPlan(result.plan, {
      message: input.message,
      priorExecution: input.priorExecution,
      conversation: input.conversation,
    }),
    usage: {
      ...(result.usage || {}),
      quality_recovery_semantic_policy: 3,
    },
  }
}
