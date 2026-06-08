import type { DocumentData } from '../../types';
import type { IntentClassification } from './intentTypes';

export type BehaviorMode =
  | 'chat_only'
  | 'ask_clarifying_questions'
  | 'draft_with_assumptions'
  | 'update_existing_document'
  | 'suggest_next_step';

export type BehaviorDomain =
  | 'sap_crm_iys'
  | 'digital_contract'
  | 'integration_project'
  | 'crm_process'
  | 'document_management'
  | 'generic_ba';

export type BehaviorTemplate = 'corporate_conceptual_design' | 'none';
export type BehaviorDepth = 'light' | 'standard' | 'deep';

export interface BehaviorDecision {
  mode: BehaviorMode;
  domain: BehaviorDomain;
  requiredTemplate: BehaviorTemplate;
  depth: BehaviorDepth;
  shouldAskQuestions: boolean;
  shouldUpdateDocument: boolean;
  shouldUseAssumptions: boolean;
  shouldUseResearch: boolean;
  questionBudget: number;
  clarificationQuestions: string[];
  confidence: number;
  reason: string;
}

interface BehaviorDecisionInput {
  userMessage: string;
  document: DocumentData | null;
  classification: IntentClassification;
  discoveryReadiness?: number;
}

const FORCE_DRAFT_RE = /\b(devam|ilerle|olu[şs]tur|haz[ıi]rla|yaz|taslak|varsay[ıi]mlarla|bu bilgilerle|mevcut bilgilerle|uygula|başla|basla|daha fazla soru sorma|soru sorma)\b/i;
const STOP_QUESTIONS_RE = /\b(daha fazla soru sorma|soru sorma|soru istemiyorum|varsay[ıi]mlarla|mevcut bilgilerle|bu bilgilerle|direkt oluştur|direkt olustur)\b/i;
const DOCUMENT_REQUEST_RE = /\b(ba analiz|iş analiz|is analiz|kavramsal|tasar[ıi]m|dok[üu]man|fdd|brd|gereksinim|s[üu]re[çc]|entegrasyon|api|test|kabul kriter|review|risk)\b/i;
const GREETING_ONLY_RE = /^\s*(selam|selamlar|merhaba|merhabalar|mrb|slm|hey|hi|hello|naber|nas[ıi]ls[ıi]n)\s*[!.?]*\s*$/i;

function hasDocument(document: DocumentData | null): boolean {
  if (!document) return false;
  return Object.values(document as any).some((section: any) => section?.content && String(section.content).trim().length > 0);
}

function detectDomain(message: string): BehaviorDomain {
  const text = message.toLocaleLowerCase('tr-TR');
  if (/sap\s*crm/i.test(text) && /(iys|ileti y[oö]netim sistemi)/i.test(text)) return 'sap_crm_iys';
  if (/(dijital s[oö]zle[şs]me|e-imza|e imza|s[oö]zle[şs]me)/i.test(text)) return 'digital_contract';
  if (/(entegrasyon|integration|api|servis|middleware|sap|crm)/i.test(text)) return 'integration_project';
  if (/(crm|m[üu][şs]teri|customer|sat[ıi][şs]|pazarlama)/i.test(text)) return 'crm_process';
  if (/(dok[üu]man y[oö]netimi|filenet|dosya|ar[şs]iv|belge)/i.test(text)) return 'document_management';
  return 'generic_ba';
}

function formatQuestion(text: string, options: string[]): string {
  return `${text}\nSeçenekler: ${options.join(' | ')}`;
}

export function buildDomainQuestions(domain: BehaviorDomain): string[] {
  if (domain === 'sap_crm_iys') {
    return [
      formatQuestion('İYS izin kapsamı hangi iletişim kanallarını içermeli?', ['SMS/MESAJ + EPOSTA + ARAMA', 'Sadece SMS/EPOSTA', 'Varsayımla tüm kanallar']),
      formatQuestion('Şirket İYS tarafında tek marka kodu mu, çoklu marka yapısı mı kullanıyor?', ['Tek marka kodu', 'Çoklu marka', 'Varsayımla çoklu marka desteklensin']),
      formatQuestion('SAP CRM ile İYS arasında hangi ara katman varsayılsın?', ['SAP CPI', 'SAP PI/PO', 'Varsayımla karar açık kalsın']),
      formatQuestion('İlk aktarım ve günlük mutabakat kapsamı nasıl ele alınsın?', ['Initial load + günlük delta', 'Sadece günlük delta', 'Varsayımla ikisi de kapsamda']),
    ];
  }

  if (domain === 'digital_contract') {
    return [
      formatQuestion('Dijital sözleşme sürecinde imza yöntemi nasıl olmalı?', ['E-imza / mobil imza', 'OTP onay', 'Varsayımla iki seçenek de değerlendirilsin']),
      formatQuestion('Sözleşme saklama ve arşivleme nerede yapılacak?', ['FileNet / DMS', 'Uygulama içi saklama', 'Açık konu olarak kalsın']),
      formatQuestion('Onay akışı hangi rolleri içermeli?', ['Müşteri + operasyon', 'Müşteri + satış + hukuk', 'Varsayımla çok rollü akış']),
    ];
  }

  if (domain === 'integration_project') {
    return [
      formatQuestion('Entegrasyon tipi nasıl ilerlemeli?', ['REST API', 'Batch / dosya aktarımı', 'Varsayımla hibrit yapı']),
      formatQuestion('Hata yönetimi nasıl tasarlansın?', ['Retry + kuyruk', 'Manuel operasyon iş listesi', 'İkisi de kapsamda']),
      formatQuestion('Ana veri kaynağı hangi sistem olsun?', ['Kaynak sistem', 'Hedef sistem', 'Açık konu olarak işaretle']),
    ];
  }

  return [
    formatQuestion('İlk taslakta hangi kapsamı hedefleyelim?', ['MVP kapsam', 'Uçtan uca kapsam', 'Varsayımlarla geniş taslak']),
    formatQuestion('Başarıyı hangi iş değeriyle ölçelim?', ['Süre azaltma', 'Hata azaltma', 'İzlenebilirlik / uyum']),
    formatQuestion('Doküman hangi seviyede olsun?', ['Kavramsal tasarım', 'BRD/FDD', 'Varsayımla kurumsal kavramsal tasarım']),
  ];
}

export function buildBehaviorDecision(input: BehaviorDecisionInput): BehaviorDecision {
  const message = input.userMessage || '';
  const domain = detectDomain(message);
  const hasExistingDocument = hasDocument(input.document);
  const forceDraft = FORCE_DRAFT_RE.test(message);
  const stopQuestions = STOP_QUESTIONS_RE.test(message);
  const documentRequest = DOCUMENT_REQUEST_RE.test(message) || input.classification.documentImpact === 'updates_document';
  const shortDomainRequest = message.trim().length < 80 && documentRequest && !forceDraft && !hasExistingDocument;
  const readiness = input.discoveryReadiness ?? 0;

  if (GREETING_ONLY_RE.test(message)) {
    return {
      mode: 'chat_only',
      domain: 'generic_ba',
      requiredTemplate: 'none',
      depth: 'light',
      shouldAskQuestions: false,
      shouldUpdateDocument: false,
      shouldUseAssumptions: false,
      shouldUseResearch: false,
      questionBudget: 0,
      clarificationQuestions: [],
      confidence: 0.95,
      reason: 'behavior:greeting_only',
    };
  }

  if ((forceDraft || stopQuestions) && documentRequest) {
    return {
      mode: hasExistingDocument ? 'update_existing_document' : 'draft_with_assumptions',
      domain,
      requiredTemplate: 'corporate_conceptual_design',
      depth: domain === 'generic_ba' ? 'standard' : 'deep',
      shouldAskQuestions: false,
      shouldUpdateDocument: true,
      shouldUseAssumptions: true,
      shouldUseResearch: domain !== 'generic_ba',
      questionBudget: 0,
      clarificationQuestions: [],
      confidence: 0.9,
      reason: `behavior:force_draft_with_assumptions:${domain}`,
    };
  }

  if (shortDomainRequest && readiness < 65) {
    return {
      mode: 'ask_clarifying_questions',
      domain,
      requiredTemplate: 'corporate_conceptual_design',
      depth: domain === 'generic_ba' ? 'standard' : 'deep',
      shouldAskQuestions: true,
      shouldUpdateDocument: false,
      shouldUseAssumptions: false,
      shouldUseResearch: domain !== 'generic_ba',
      questionBudget: domain === 'generic_ba' ? 3 : 4,
      clarificationQuestions: buildDomainQuestions(domain),
      confidence: 0.82,
      reason: `behavior:short_domain_discovery:${domain}`,
    };
  }

  if (documentRequest) {
    return {
      mode: hasExistingDocument ? 'update_existing_document' : 'draft_with_assumptions',
      domain,
      requiredTemplate: 'corporate_conceptual_design',
      depth: domain === 'generic_ba' ? 'standard' : 'deep',
      shouldAskQuestions: false,
      shouldUpdateDocument: true,
      shouldUseAssumptions: true,
      shouldUseResearch: domain !== 'generic_ba',
      questionBudget: 0,
      clarificationQuestions: [],
      confidence: 0.78,
      reason: `behavior:document_request:${domain}`,
    };
  }

  return {
    mode: 'suggest_next_step',
    domain,
    requiredTemplate: 'none',
    depth: 'light',
    shouldAskQuestions: false,
    shouldUpdateDocument: false,
    shouldUseAssumptions: false,
    shouldUseResearch: false,
    questionBudget: 0,
    clarificationQuestions: [],
    confidence: 0.6,
    reason: `behavior:default:${domain}`,
  };
}

function focusForDomain(domain: BehaviorDomain): IntentClassification['baAgentFocus'] {
  if (domain === 'sap_crm_iys' || domain === 'integration_project') return 'technical_analysis';
  return 'business_analysis';
}

export function applyBehaviorDecisionToClassification(
  classification: IntentClassification,
  decision: BehaviorDecision,
  existingDocument: DocumentData | null,
): IntentClassification {
  if (decision.mode === 'chat_only') {
    return {
      ...classification,
      documentImpact: 'none',
      operation: 'none',
      requiresClarification: false,
      clarificationQuestions: undefined,
      shouldRunBaAgentLoop: false,
      confidence: Math.max(classification.confidence, decision.confidence),
      reason: `${classification.reason}; ${decision.reason}`,
    };
  }

  if (decision.mode === 'ask_clarifying_questions') {
    return {
      ...classification,
      documentImpact: 'none',
      operation: 'none',
      requiresClarification: true,
      clarificationQuestions: decision.clarificationQuestions.slice(0, decision.questionBudget),
      shouldRunBaAgentLoop: false,
      requiresResearch: classification.requiresResearch || decision.shouldUseResearch,
      researchType: classification.researchType || (decision.shouldUseResearch ? 'web' : undefined),
      confidence: Math.max(classification.confidence, decision.confidence),
      reason: `${classification.reason}; ${decision.reason}`,
    };
  }

  if (decision.shouldUpdateDocument) {
    const hasExisting = hasDocument(existingDocument);
    return {
      ...classification,
      primaryIntent: 'analysis_generation',
      subIntent: classification.primaryIntent === 'analysis_generation' ? classification.subIntent : 'generate_business_analysis',
      targetSection: 'businessAnalysis',
      documentImpact: 'updates_document',
      operation: hasExisting ? 'append_to_section' : 'replace_or_create_section',
      requiresClarification: false,
      clarificationQuestions: undefined,
      requiresPreview: false,
      shouldRunBaAgentLoop: true,
      requiresResearch: classification.requiresResearch || decision.shouldUseResearch,
      researchType: classification.researchType || (decision.shouldUseResearch ? 'web' : undefined),
      baAgentFocus: classification.baAgentFocus || focusForDomain(decision.domain),
      confidence: Math.max(classification.confidence, decision.confidence),
      reason: `${classification.reason}; ${decision.reason}; template:${decision.requiredTemplate}; depth:${decision.depth}`,
    };
  }

  return {
    ...classification,
    reason: `${classification.reason}; ${decision.reason}`,
  };
}
