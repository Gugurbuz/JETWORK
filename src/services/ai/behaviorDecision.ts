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
  | 'sap_crm_ai_sales_bot'
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

const FORCE_DRAFT_RE = /\b(devam|ilerle|olu[\u015fs]tur|haz[\u0131i]rla|yaz|taslak|varsay[\u0131i]mlarla|bu bilgilerle|mevcut bilgilerle|uygula|ba\u015fla|basla|daha fazla soru sorma|soru sorma)\b/i;
const STOP_QUESTIONS_RE = /\b(daha fazla soru sorma|soru sorma|soru istemiyorum|varsay[\u0131i]mlarla|mevcut bilgilerle|bu bilgilerle|direkt olu\u015ftur|direkt olustur)\b/i;
const DOCUMENT_REQUEST_RE = /\b(ba analiz|i\u015f analiz|is analiz|kavramsal|tasar[\u0131i]m|dok[\u00fcu]man|fdd|brd|gereksinim|s[\u00fcu]re[\u00e7c]|entegrasyon|api|test|kabul kriter|review|risk|proje\w*|project\w*|bot\w*|asistan\w*|assistant\w*|chatbot\w*)\b/i;
const NORMALIZED_DOCUMENT_REQUEST_RE = /\b(ba analiz|is analiz|kavramsal|tasarim|dokuman|fdd|brd|gereksinim|surec|entegrasyon|api|test|kabul kriter|review|risk|proje\w*|project\w*|bot\w*|asistan\w*|assistant\w*|chatbot\w*|satis|sales)\b/i;
const GREETING_ONLY_RE = /^\s*(selam|selamlar|merhaba|merhabalar|mrb|slm|hey|hi|hello|naber|nas[\u0131i]ls[\u0131i]n)\s*[!.?]*\s*$/i;

function normalizeDomainText(value: string): string {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c');
}

function hasDocument(document: DocumentData | null): boolean {
  if (!document) return false;
  return Object.values(document as any).some((section: any) => section?.content && String(section.content).trim().length > 0);
}

function isSapCrmAiSalesBot(message: string): boolean {
  const text = normalizeDomainText(message);
  return /sap\s*crm/.test(text)
    && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis|lead|opportunity|firsat|musteri)/.test(text);
}

function detectDomain(message: string): BehaviorDomain {
  const text = normalizeDomainText(message);
  if (/sap\s*crm/.test(text) && /(iys|ileti yonetim sistemi)/.test(text)) return 'sap_crm_iys';
  if (isSapCrmAiSalesBot(message)) return 'sap_crm_ai_sales_bot';
  if (/(dijital sozlesme|e-imza|e imza|sozlesme)/.test(text)) return 'digital_contract';
  if (/(entegrasyon|integration|api|servis|middleware|sap|crm)/.test(text)) return 'integration_project';
  if (/(crm|musteri|customer|satis|pazarlama)/.test(text)) return 'crm_process';
  if (/(dokuman yonetimi|filenet|dosya|arsiv|belge)/.test(text)) return 'document_management';
  return 'generic_ba';
}

function formatQuestion(text: string, options: string[]): string {
  return `${text}\nSecenekler: ${options.join(' | ')}`;
}

export function buildDomainQuestions(domain: BehaviorDomain): string[] {
  if (domain === 'sap_crm_iys') {
    return [
      formatQuestion('IYS izin kapsami hangi iletisim kanallarini icermeli?', ['SMS/MESAJ + EPOSTA + ARAMA', 'Sadece SMS/EPOSTA', 'Varsayimla tum kanallar']),
      formatQuestion('Sirket IYS tarafinda tek marka kodu mu, coklu marka yapisi mi kullaniyor?', ['Tek marka kodu', 'Coklu marka', 'Varsayimla coklu marka desteklensin']),
      formatQuestion('SAP CRM ile IYS arasinda hangi ara katman varsayilsin?', ['SAP CPI', 'SAP PI/PO', 'Varsayimla karar acik kalsin']),
      formatQuestion('Ilk aktarim ve gunluk mutabakat kapsami nasil ele alinsin?', ['Initial load + gunluk delta', 'Sadece gunluk delta', 'Varsayimla ikisi de kapsamda']),
    ];
  }

  if (domain === 'sap_crm_ai_sales_bot') {
    return [
      formatQuestion('AI satis botu hangi kanallarda calisacak?', ['Web chat + WhatsApp', 'SAP CRM icinde temsilci asistani', 'Varsayimla coklu kanal']),
      formatQuestion('SAP CRM tarafinda hangi satis nesneleri yonetilecek?', ['Lead + Opportunity + Activity', 'Sadece lead olusturma', 'Varsayimla lead ve opportunity kapsamda']),
      formatQuestion('Bot hangi seviyede aksiyon alabilecek?', ['Sadece oneri ve ozet', 'Lead nitelendirme + CRM kaydi', 'Varsayimla kritik islemler temsilci onayli']),
      formatQuestion('Insana devir ve kalite kontrol nasil ilerlesin?', ['Dusuk guvende temsilciye devir', 'Tum satis aksiyonlari onayli', 'Varsayimla risk bazli devir modeli']),
    ];
  }

  if (domain === 'digital_contract') {
    return [
      formatQuestion('Dijital sozlesme surecinde imza yontemi nasil olmali?', ['E-imza / mobil imza', 'OTP onay', 'Varsayimla iki secenek de degerlendirilsin']),
      formatQuestion('Sozlesme saklama ve arsivleme nerede yapilacak?', ['FileNet / DMS', 'Uygulama ici saklama', 'Acik konu olarak kalsin']),
      formatQuestion('Onay akisi hangi rolleri icermeli?', ['Musteri + operasyon', 'Musteri + satis + hukuk', 'Varsayimla cok rollu akis']),
    ];
  }

  if (domain === 'integration_project') {
    return [
      formatQuestion('Entegrasyon tipi nasil ilerlemeli?', ['REST API', 'Batch / dosya aktarimi', 'Varsayimla hibrit yapi']),
      formatQuestion('Hata yonetimi nasil tasarlansin?', ['Retry + kuyruk', 'Manuel operasyon is listesi', 'Ikisi de kapsamda']),
      formatQuestion('Ana veri kaynagi hangi sistem olsun?', ['Kaynak sistem', 'Hedef sistem', 'Acik konu olarak isaretle']),
    ];
  }

  return [
    formatQuestion('Ilk taslakta hangi kapsami hedefleyelim?', ['MVP kapsam', 'Uctan uca kapsam', 'Varsayimlarla genis taslak']),
    formatQuestion('Basariyi hangi is degeriyle olcelim?', ['Sure azaltma', 'Hata azaltma', 'Izlenebilirlik / uyum']),
    formatQuestion('Dokuman hangi seviyede olsun?', ['Kavramsal tasarim', 'BRD/FDD', 'Varsayimla kurumsal kavramsal tasarim']),
  ];
}

export function buildBehaviorDecision(input: BehaviorDecisionInput): BehaviorDecision {
  const message = input.userMessage || '';
  const normalizedMessage = normalizeDomainText(message);
  const domain = detectDomain(message);
  const hasExistingDocument = hasDocument(input.document);
  const forceDraft = FORCE_DRAFT_RE.test(message);
  const stopQuestions = STOP_QUESTIONS_RE.test(message);
  const strongDomainRequest = domain !== 'generic_ba' && domain !== 'crm_process';
  const documentRequest =
    DOCUMENT_REQUEST_RE.test(message)
    || NORMALIZED_DOCUMENT_REQUEST_RE.test(normalizedMessage)
    || strongDomainRequest
    || input.classification.documentImpact === 'updates_document';
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
