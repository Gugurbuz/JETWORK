import type { DocumentData } from '../../types';
import type { IntentClassification } from './intentTypes';
import {
  buildCriticalInfoForDomain,
  buildDiscoveryRationalesForDomain,
  buildDomainDiscoveryQuestions,
} from './baDiscoveryProfiles';
import { getPrimaryDomainProfile, type DomainProfileId } from '../domainProfiles';

export type BehaviorMode =
  | 'chat_only'
  | 'ask_clarifying_questions'
  | 'draft_with_assumptions'
  | 'update_existing_document'
  | 'suggest_next_step';

export type BehaviorDomain =
  | 'sap_crm_iys'
  | 'sap_crm_ai_sales_bot'
  | 'ai_assistant_product'
  | 'field_mobile_app'
  | 'operations_platform'
  | 'digital_contract'
  | 'integration_project'
  | 'crm_process'
  | 'document_management'
  | 'generic_ba';

export type BehaviorTemplate = 'corporate_conceptual_design' | 'none';
export type BehaviorDepth = 'light' | 'standard' | 'deep';
export type BehaviorUserIntent =
  | 'small_talk'
  | 'new_project_idea'
  | 'explicit_document_generation'
  | 'document_revision'
  | 'quality_or_review'
  | 'continuation'
  | 'unknown';
export type BehaviorQuestionStrategy =
  | 'none'
  | 'domain_discovery'
  | 'critical_gap_only'
  | 'assumption_first';
export type BehaviorDocumentAction =
  | 'none'
  | 'create_conceptual_draft'
  | 'update_existing_document'
  | 'suggest_next_step';
export type BehaviorAssumptionPolicy =
  | 'do_not_assume'
  | 'mark_noncritical_assumptions'
  | 'draft_with_marked_assumptions';

export interface HumanBaProfile {
  userIntent: BehaviorUserIntent;
  projectDomain: BehaviorDomain;
  missingCriticalInfo: string[];
  questionRationale: string[];
  recommendedNextAction: string;
  questionStrategy: BehaviorQuestionStrategy;
  documentAction: BehaviorDocumentAction;
  assumptionPolicy: BehaviorAssumptionPolicy;
  responseStance: string;
}

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
  humanProfile: HumanBaProfile;
}

interface BehaviorDecisionInput {
  userMessage: string;
  document: DocumentData | null;
  classification: IntentClassification;
  discoveryReadiness?: number;
}

const FORCE_DRAFT_RE = /\b(varsay[\u0131i]mlarla|bu bilgilerle|mevcut bilgilerle|h[\u0131i]zl[\u0131i] taslak|ilk tasla[\u011f]?[i\u0131]?\s*(c[\u0131i]kar|olu[\u015fs]tur|haz[\u0131i]rla|uret|\u00fcret|yaz)|kabaca taslak|taslakla ilerle|uygula|sen yap|ben mi yap[\u0131i]cam|ben mi yapacagim|devam et|durma|daha fazla soru sorma|soru sorma)\b/i;
const STOP_QUESTIONS_RE = /\b(daha fazla soru sorma|soru sorma|soru istemiyorum|sorular[\u0131i] b[\u0131i]rak|sorulari birak|varsay[\u0131i]mlarla|mevcut bilgilerle|bu bilgilerle|direkt olu\u015ftur|direkt olustur|ben mi yap[\u0131i]cam|ben mi yapacagim|sen yap)\b/i;
const DOCUMENT_REQUEST_RE = /\b(ba analiz|i\u015f analiz|is analiz|kavramsal|tasar[\u0131i]m|dok[\u00fcu]man|fdd|brd|gereksinim|s[\u00fcu]re[\u00e7c]|entegrasyon|api|test|kabul kriter|review|risk|proje\w*|project\w*|bot\w*|asistan\w*|assistant\w*|chatbot\w*)\b/i;
const NORMALIZED_DOCUMENT_REQUEST_RE = /\b(ba analiz|is analiz|kavramsal|tasarim|dokuman|fdd|brd|gereksinim|surec|entegrasyon|api|test|kabul kriter|review|risk|proje\w*|project\w*|bot\w*|asistan\w*|assistant\w*|chatbot\w*|satis|sales)\b/i;
const EXPLICIT_DOCUMENT_GENERATION_RE = /\b(ba analiz|is analiz|i\u015f analiz|kavramsal|tasar[\u0131i]m|dok[\u00fcu]man|rapor|fdd|brd|gereksinim dok[\u00fcu]man[\u0131i]|haz[\u0131i]rla|olu[\u015fs]tur|uret|\u00fcret|yaz|taslak|c[\u0131i]kar|word format)\b/i;
const NORMALIZED_EXPLICIT_DOCUMENT_GENERATION_RE = /\b(ba analiz|is analiz|kavramsal|tasarim|dokuman|rapor|fdd|brd|gereksinim dokumani|hazirla|olustur|uret|yaz|taslak|cikar|word format)\b/i;
const CONTEXT_FOLLOW_UP_RE = /\b(simdi|sirada|sonra ne|ne yapalim|ne yapacagiz|ne durumdayiz|next step|hangi adim|devami ne)\b/i;
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
    && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis botu|sales bot|lead|opportunity|firsat)/.test(text);
}

function countDomainAnswerHints(domain: BehaviorDomain, normalizedMessage: string): number {
  const hintGroups: Partial<Record<BehaviorDomain, RegExp[]>> = {
    sap_crm_ai_sales_bot: [
      /\b(web|whatsapp|mobil|mobile|teams|slack|kanal|omnichannel|chat)\b/i,
      /\b(lead|opportunity|activity|business partner|bp|contact|mql|firsat)\b/i,
      /\b(onay|yetki|kayit|kayıt|temsilci|handoff|devir|audit|log)\b/i,
      /\b(kvkk|guven|güven|risk|insan|human|escalation|eskalasyon)\b/i,
    ],
    sap_crm_iys: [
      /\b(sms|mesaj|eposta|e-posta|arama|kanal)\b/i,
      /\b(marka|brand|kod|coklu marka|tek marka)\b/i,
      /\b(cpi|pi\/po|middleware|ara katman|rest|api)\b/i,
      /\b(initial|delta|mutabakat|batch|gunluk|günlük)\b/i,
    ],
    ai_assistant_product: [
      /\b(sohbet|chat|conversation|derinlik|reasoning|dusunme|akil)\b/i,
      /\b(memory|hafiza|context|kaynak|rag|knowledge)\b/i,
      /\b(tool|arac|aksiyon|agent|workflow|orchestrator)\b/i,
      /\b(eval|test|guardrail|guvenlik|yetki|audit|handoff)\b/i,
    ],
    field_mobile_app: [
      /\b(saha|d2d|door|mobile|mobil|offline|rota|konum)\b/i,
      /\b(satis|lead|musteri|ziyaret|teklif|siparis)\b/i,
      /\b(sync|senkron|delta|cache|cihaz|tablet)\b/i,
      /\b(validasyon|foto|imza|evrak|stok|tahsilat)\b/i,
    ],
    operations_platform: [
      /\b(operasyon|is listesi|workflow|onay|sla|gorev|queue)\b/i,
      /\b(iade|iptal|talep|case|ticket|basvuru|mutabakat)\b/i,
      /\b(erp|odeme|finans|muhasebe|portal|bildirim)\b/i,
      /\b(rapor|dashboard|kpi|hata|eskalasyon)\b/i,
    ],
    digital_contract: [
      /\b(e-imza|mobil imza|otp|kimlik|onay)\b/i,
      /\b(arsiv|arşiv|filenet|dms|saklama)\b/i,
      /\b(hukuk|operasyon|musteri|müşteri|rol|raci)\b/i,
    ],
    integration_project: [
      /\b(rest|soap|batch|dosya|api|webhook)\b/i,
      /\b(retry|kuyruk|queue|hata|log|monitoring)\b/i,
      /\b(kaynak|hedef|master|ana veri|veri sahibi)\b/i,
    ],
  };
  return (hintGroups[domain] || []).filter((pattern) => pattern.test(normalizedMessage)).length;
}

function detectDomain(message: string): BehaviorDomain {
  const profileDomainMap: Partial<Record<DomainProfileId, BehaviorDomain>> = {
    sap_crm_iys: 'sap_crm_iys',
    sap_crm_ai_sales_bot: 'sap_crm_ai_sales_bot',
    field_mobile_app: 'field_mobile_app',
    operations_platform: 'operations_platform',
    digital_contract: 'digital_contract',
    integration_project: 'integration_project',
  };
  const profileDomain = getPrimaryDomainProfile(message)?.id;
  if (profileDomain && profileDomainMap[profileDomain]) return profileDomainMap[profileDomain]!;

  const text = normalizeDomainText(message);
  if (/sap\s*crm/.test(text) && /(iys|ileti yonetim sistemi)/.test(text)) return 'sap_crm_iys';
  if (isSapCrmAiSalesBot(message)) return 'sap_crm_ai_sales_bot';
  if (/(yapay zeka|ai|copilot|chatbot|asistan|assistant|sohbet)/.test(text)
    && /(urun|product|motor|akil|davranis|mindset|tool|arac|hafiza|memory|agent|orchestrator|derinlik|derinlig|yetenek)/.test(text)) {
    return 'ai_assistant_product';
  }
  if (/(saha|d2d|door to door|door-to-door|mobil|mobile|tablet|offline)/.test(text)
    && /(satis|sales|uygulama|app|refactor|donusum|donusumu|crm|musteri)/.test(text)) {
    return 'field_mobile_app';
  }
  if (/(operasyon|iade|iptal|talep|case|ticket|is listesi|workflow|onay|sla)/.test(text)
    && /(platform|uygulama|sistem|portal|surec|proje|erp|odeme|finans)/.test(text)) {
    return 'operations_platform';
  }
  if (/(dijital sozlesme|e-imza|e imza|sozlesme)/.test(text)) return 'digital_contract';
  if (/(entegrasyon|integration|api|servis|middleware|sap|crm)/.test(text)) return 'integration_project';
  if (/(crm|musteri|customer|satis|pazarlama)/.test(text)) return 'crm_process';
  if (/(dokuman yonetimi|filenet|dosya|arsiv|belge)/.test(text)) return 'document_management';
  return 'generic_ba';
}

function domainLabel(domain: BehaviorDomain): string {
  const labels: Record<BehaviorDomain, string> = {
    sap_crm_iys: 'SAP CRM - IYS entegrasyonu',
    sap_crm_ai_sales_bot: 'SAP CRM AI satis botu',
    ai_assistant_product: 'AI asistan urunu',
    field_mobile_app: 'Saha/mobil uygulama',
    operations_platform: 'Operasyon platformu',
    digital_contract: 'Dijital sozlesme',
    integration_project: 'Entegrasyon projesi',
    crm_process: 'CRM sureci',
    document_management: 'Dokuman yonetimi',
    generic_ba: 'Genel is analizi',
  };
  return labels[domain];
}

function criticalInfoForDomain(domain: BehaviorDomain): string[] {
  return buildCriticalInfoForDomain(domain);
}

interface HumanProfileContext {
  hasExistingDocument: boolean;
  forceDraft: boolean;
  stopQuestions: boolean;
  explicitDocumentGeneration: boolean;
  strongDomainRequest: boolean;
  contextFollowUp: boolean;
}

function inferUserIntent(
  decision: Omit<BehaviorDecision, 'humanProfile'>,
  context: HumanProfileContext,
): BehaviorUserIntent {
  if (decision.mode === 'chat_only') return 'small_talk';
  if (context.contextFollowUp) return 'continuation';
  if (context.forceDraft || context.stopQuestions) return 'continuation';
  if (context.hasExistingDocument && decision.shouldUpdateDocument) return 'document_revision';
  if (decision.mode === 'ask_clarifying_questions' && context.strongDomainRequest) return 'new_project_idea';
  if (context.explicitDocumentGeneration || decision.mode === 'draft_with_assumptions') return 'explicit_document_generation';
  if (decision.domain !== 'generic_ba') return 'new_project_idea';
  return 'unknown';
}

function questionStrategyForDecision(decision: Omit<BehaviorDecision, 'humanProfile'>): BehaviorQuestionStrategy {
  if (decision.mode === 'ask_clarifying_questions' && decision.domain !== 'generic_ba') return 'domain_discovery';
  if (decision.mode === 'ask_clarifying_questions') return 'critical_gap_only';
  if (decision.shouldUseAssumptions) return 'assumption_first';
  return 'none';
}

function documentActionForDecision(
  decision: Omit<BehaviorDecision, 'humanProfile'>,
  hasExistingDocument: boolean,
): BehaviorDocumentAction {
  if (!decision.shouldUpdateDocument) {
    return decision.mode === 'suggest_next_step' ? 'suggest_next_step' : 'none';
  }
  return hasExistingDocument ? 'update_existing_document' : 'create_conceptual_draft';
}

function assumptionPolicyForDecision(decision: Omit<BehaviorDecision, 'humanProfile'>): BehaviorAssumptionPolicy {
  if (decision.shouldUseAssumptions && decision.shouldUpdateDocument) return 'draft_with_marked_assumptions';
  if (decision.shouldUseAssumptions) return 'mark_noncritical_assumptions';
  return 'do_not_assume';
}

function responseStanceForDecision(decision: Omit<BehaviorDecision, 'humanProfile'>): string {
  if (decision.mode === 'ask_clarifying_questions') {
    return 'Kisa, dogal ve domain farkindaligi olan bir giris yap; genel BA sorulari yerine kritik karar sorularini sor.';
  }
  if (decision.shouldUpdateDocument) {
    return 'Ne yapildigini, hangi varsayimlarla ilerledigini ve kalan acik konulari net soyle; detaylari sag panele yaz.';
  }
  if (decision.mode === 'chat_only') {
    return 'Kisa ve dogal cevap ver; gereksiz soru karti uretme.';
  }
  return 'Baglama gore sonraki en iyi adimi oner.';
}

function recommendedNextActionForDecision(
  decision: Omit<BehaviorDecision, 'humanProfile'>,
  context: HumanProfileContext,
): string {
  const label = domainLabel(decision.domain);
  if (decision.mode === 'ask_clarifying_questions') {
    return `${label} icin kritik kararlari netlestir; kullanici isterse "Varsayimlarla ilerle" sinyaliyle ilk taslagi uret.`;
  }
  if (decision.shouldUpdateDocument) {
    return context.hasExistingDocument
      ? `${label} dokumanini mevcut icerigi koruyarak derinlestir ve belirsizlikleri Review'a isle.`
      : `${label} icin kurumsal kavramsal taslak uret; bilinmeyenleri [VARSAYIM] ve [ACIK KONU] olarak ayir.`;
  }
  if (decision.mode === 'chat_only') return 'Kisa sohbet cevabi ver ve kullaniciyi talep yazmaya davet et.';
  if (context.contextFollowUp) return 'Son baglama gore sonraki en iyi aksiyonu oner; yeni soru seti acma.';
  return 'Baglamdan sonraki en iyi BA aksiyonunu oner.';
}

function buildHumanBaProfile(
  decision: Omit<BehaviorDecision, 'humanProfile'>,
  context: HumanProfileContext,
): HumanBaProfile {
  return {
    userIntent: inferUserIntent(decision, context),
    projectDomain: decision.domain,
    missingCriticalInfo: decision.mode === 'ask_clarifying_questions'
      ? criticalInfoForDomain(decision.domain).slice(0, decision.questionBudget || 3)
      : [],
    questionRationale: decision.mode === 'ask_clarifying_questions'
      ? buildDiscoveryRationalesForDomain(decision.domain).slice(0, decision.questionBudget || 3)
      : [],
    recommendedNextAction: recommendedNextActionForDecision(decision, context),
    questionStrategy: questionStrategyForDecision(decision),
    documentAction: documentActionForDecision(decision, context.hasExistingDocument),
    assumptionPolicy: assumptionPolicyForDecision(decision),
    responseStance: responseStanceForDecision(decision),
  };
}

function finalizeDecision(
  decision: Omit<BehaviorDecision, 'humanProfile'>,
  context: HumanProfileContext,
): BehaviorDecision {
  return {
    ...decision,
    humanProfile: buildHumanBaProfile(decision, context),
  };
}

export function buildDomainQuestions(domain: BehaviorDomain): string[] {
  return buildDomainDiscoveryQuestions(domain);
}

export function buildBehaviorDecision(input: BehaviorDecisionInput): BehaviorDecision {
  const message = input.userMessage || '';
  const normalizedMessage = normalizeDomainText(message);
  const domain = detectDomain(message);
  const hasExistingDocument = hasDocument(input.document);
  const forceDraft = FORCE_DRAFT_RE.test(message);
  const stopQuestions = STOP_QUESTIONS_RE.test(message);
  const contextFollowUp = CONTEXT_FOLLOW_UP_RE.test(normalizedMessage);
  const strongDomainRequest = domain !== 'generic_ba' && domain !== 'crm_process';
  const explicitDocumentGeneration =
    EXPLICIT_DOCUMENT_GENERATION_RE.test(message)
    || NORMALIZED_EXPLICIT_DOCUMENT_GENERATION_RE.test(normalizedMessage)
    || forceDraft
    || stopQuestions;
  const documentRequest =
    DOCUMENT_REQUEST_RE.test(message)
    || NORMALIZED_DOCUMENT_REQUEST_RE.test(normalizedMessage)
    || strongDomainRequest
    || input.classification.documentImpact === 'updates_document'
    || (hasExistingDocument && (forceDraft || stopQuestions));
  const shortDomainRequest = message.trim().length < 80 && documentRequest && !forceDraft && !hasExistingDocument;
  const focusedArtifactRequest =
    ['test', 'flow', 'review', 'quality'].includes(String(input.classification.baAgentFocus || ''))
    || [
      'generate_test_cases',
      'generate_flow_diagram',
      'generate_bpmn',
      'generate_mermaid',
      'generate_api_contract',
      'generate_technical_analysis',
      'generate_developer_handoff',
      'generate_review_report',
      'find_risks',
      'review_document_quality',
      'score_document',
    ].includes(String(input.classification.subIntent || ''));
  const readiness = input.discoveryReadiness ?? 0;
  const tokenCount = normalizedMessage.split(/\s+/).filter(Boolean).length;
  const domainAnswerHintCount = countDomainAnswerHints(domain, normalizedMessage);
  const sparseNewDomainRequest =
    strongDomainRequest
    && !hasExistingDocument
    && tokenCount <= 14
    && domainAnswerHintCount < 2;
  const shouldAskOnlyIfCritical = shortDomainRequest && readiness < 35 && !strongDomainRequest && !focusedArtifactRequest;
  const shouldDiscoverDomainBeforeDraft =
    strongDomainRequest
    && documentRequest
    && !hasExistingDocument
    && !forceDraft
    && !stopQuestions
    && !focusedArtifactRequest
    && (readiness < 55 || sparseNewDomainRequest);
  const humanContext: HumanProfileContext = {
    hasExistingDocument,
    forceDraft,
    stopQuestions,
    explicitDocumentGeneration,
    strongDomainRequest,
    contextFollowUp,
  };

  if (GREETING_ONLY_RE.test(message)) {
    return finalizeDecision({
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
    }, humanContext);
  }

  if ((forceDraft || stopQuestions) && documentRequest) {
    return finalizeDecision({
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
    }, humanContext);
  }

  if (shouldDiscoverDomainBeforeDraft) {
    return finalizeDecision({
      mode: 'ask_clarifying_questions',
      domain,
      requiredTemplate: 'corporate_conceptual_design',
      depth: 'deep',
      shouldAskQuestions: true,
      shouldUpdateDocument: false,
      shouldUseAssumptions: false,
      shouldUseResearch: true,
      questionBudget: 4,
      clarificationQuestions: buildDomainQuestions(domain),
      confidence: 0.86,
      reason: `behavior:domain_discovery_before_draft:${domain}`,
    }, humanContext);
  }

  if (shouldAskOnlyIfCritical) {
    return finalizeDecision({
      mode: 'ask_clarifying_questions',
      domain,
      requiredTemplate: 'corporate_conceptual_design',
      depth: domain === 'generic_ba' ? 'standard' : 'deep',
      shouldAskQuestions: true,
      shouldUpdateDocument: false,
      shouldUseAssumptions: false,
      shouldUseResearch: domain !== 'generic_ba',
      questionBudget: 3,
      clarificationQuestions: buildDomainQuestions(domain),
      confidence: 0.82,
      reason: `behavior:short_domain_discovery:${domain}`,
    }, humanContext);
  }

  if (contextFollowUp && !documentRequest) {
    return finalizeDecision({
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
      confidence: 0.74,
      reason: `behavior:context_follow_up:${domain}`,
    }, humanContext);
  }

  if (documentRequest) {
    return finalizeDecision({
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
    }, humanContext);
  }

  return finalizeDecision({
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
  }, humanContext);
}

function focusForDomain(domain: BehaviorDomain): IntentClassification['baAgentFocus'] {
  if (domain === 'sap_crm_iys' || domain === 'integration_project') return 'technical_analysis';
  return 'business_analysis';
}

function visibleTargetSectionForClassification(classification: IntentClassification): IntentClassification['targetSection'] {
  if (classification.targetSection === 'review'
    || classification.baAgentFocus === 'review'
    || classification.baAgentFocus === 'quality') {
    return 'review';
  }
  return 'businessAnalysis';
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
    const shouldPreserveSubIntent =
      classification.shouldRunBaAgentLoop
      || classification.documentImpact === 'updates_document'
      || classification.primaryIntent === 'analysis_generation'
      || classification.primaryIntent === 'document_editing'
      || classification.primaryIntent === 'quality_review';
    return {
      ...classification,
      primaryIntent: ['analysis_generation', 'document_editing', 'quality_review'].includes(classification.primaryIntent)
        ? classification.primaryIntent
        : 'analysis_generation',
      subIntent: shouldPreserveSubIntent ? classification.subIntent : 'generate_business_analysis',
      targetSection: visibleTargetSectionForClassification(classification),
      documentImpact: 'updates_document',
      operation: classification.operation !== 'none'
        ? classification.operation
        : (hasExisting ? 'append_to_section' : 'replace_or_create_section'),
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

  if (decision.mode === 'suggest_next_step') {
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

  return {
    ...classification,
    reason: `${classification.reason}; ${decision.reason}`,
  };
}

export function shouldPauseForBehaviorDiscovery(decision: BehaviorDecision): boolean {
  return decision.mode === 'ask_clarifying_questions'
    || (decision.shouldAskQuestions && !decision.shouldUpdateDocument);
}
