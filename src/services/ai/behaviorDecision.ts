import type { DocumentData } from '../../types';
import type { IntentClassification } from './intentTypes';
import {
  buildCriticalInfoForDomain,
  buildDiscoveryRationalesForDomain,
  buildDomainDiscoveryQuestions,
} from './baDiscoveryProfiles';

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
export type BehaviorUserIntent =
  | 'small_talk'
  | 'new_project_idea'
  | 'explicit_document_generation'
  | 'document_revision'
  | 'quality_or_review'
  | 'continuation'
  | 'unknown';
export type BehaviorQuestionStrategy = 'none' | 'domain_discovery' | 'critical_gap_only' | 'assumption_first';
export type BehaviorDocumentAction = 'none' | 'create_conceptual_draft' | 'update_existing_document' | 'suggest_next_step';
export type BehaviorAssumptionPolicy = 'do_not_assume' | 'mark_noncritical_assumptions' | 'draft_with_marked_assumptions';

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

interface DecisionContext {
  hasExistingDocument: boolean;
  forceDraft: boolean;
  stopQuestions: boolean;
  explicitDocumentGeneration: boolean;
  strongDomainRequest: boolean;
  contextFollowUp: boolean;
}

const FORCE_DRAFT_TERMS = [
  'varsayimlarla', 'bu bilgilerle', 'mevcut bilgilerle',
  'hizli taslak', 'ilk taslak', 'ilk taslagi', 'kabaca taslak', 'taslakla ilerle',
  'uygula', 'basla', 'baslayalim', 'tamam', 'ok', 'next', 'sonraki adim', 'sonraki adima',
  'sen yap', 'ben mi yapicam', 'ben mi yapacagim', 'devam et', 'durma',
  'daha fazla soru sorma', 'soru sorma',
];
const STOP_QUESTION_TERMS = [
  'daha fazla soru sorma', 'soru sorma', 'soru istemiyorum', 'sorulari birak',
  'varsayimlarla', 'mevcut bilgilerle', 'bu bilgilerle', 'direkt olustur',
  'ben mi yapicam', 'ben mi yapacagim', 'sen yap',
];
const DOCUMENT_TERMS = [
  'ba analiz', 'is analiz', 'kavramsal', 'tasarim', 'dokuman', 'fdd', 'brd',
  'gereksinim', 'surec', 'entegrasyon', 'api', 'test', 'kabul kriter', 'review',
  'risk', 'proje', 'project', 'bot', 'asistan', 'assistant', 'chatbot', 'satis', 'sales',
];
const EXPLICIT_GENERATION_TERMS = [
  'ba analiz', 'is analiz', 'kavramsal', 'tasarim', 'dokuman', 'rapor', 'fdd', 'brd',
  'gereksinim dokumani', 'hazirla', 'olustur', 'uret', 'yaz', 'taslak', 'cikar', 'word format',
];
const CONTEXT_FOLLOW_UP_TERMS = [
  'simdi', 'sirada', 'sonra ne', 'ne yapalim', 'ne yapacagiz', 'ne durumdayiz',
  'next step', 'hangi adim', 'devami ne',
];
const GREETING_TERMS = ['selam', 'selamlar', 'merhaba', 'merhabalar', 'mrb', 'slm', 'hey', 'hi', 'hello', 'naber', 'nasilsin'];

function normalizeDomainText(value: string): string {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/İ/g, 'i')
    .replace(/Ş/g, 's')
    .replace(/Ğ/g, 'g')
    .replace(/Ü/g, 'u')
    .replace(/Ö/g, 'o')
    .replace(/Ç/g, 'c')
    .replace(/[.!?,;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasDocument(document: DocumentData | null): boolean {
  if (!document) return false;
  return Object.values(document as any).some((section: any) => section?.content && String(section.content).trim().length > 0);
}

function isGreetingOnly(text: string): boolean {
  if (!text) return false;
  return GREETING_TERMS.includes(text.replace(/[!.?]/g, '').trim());
}

function isSapCrmAiSalesBot(text: string): boolean {
  return text.includes('sap crm')
    && hasAny(text, ['ai', 'yapay zeka', 'bot', 'chatbot', 'asistan', 'assistant', 'satis', 'lead', 'opportunity', 'firsat', 'musteri']);
}

function detectDomain(message: string): BehaviorDomain {
  const text = normalizeDomainText(message);
  if (text.includes('sap crm') && hasAny(text, ['iys', 'ileti yonetim sistemi'])) return 'sap_crm_iys';
  if (isSapCrmAiSalesBot(text)) return 'sap_crm_ai_sales_bot';
  if (hasAny(text, ['dijital sozlesme', 'e-imza', 'e imza', 'sozlesme'])) return 'digital_contract';
  if (hasAny(text, ['entegrasyon', 'integration', 'api', 'servis', 'middleware', 'sap', 'crm'])) return 'integration_project';
  if (hasAny(text, ['crm', 'musteri', 'customer', 'satis', 'pazarlama'])) return 'crm_process';
  if (hasAny(text, ['dokuman yonetimi', 'filenet', 'dosya', 'arsiv', 'belge'])) return 'document_management';
  return 'generic_ba';
}

export function buildDomainQuestions(domain: BehaviorDomain): string[] {
  return buildDomainDiscoveryQuestions(domain);
}

function domainLabel(domain: BehaviorDomain): string {
  const labels: Record<BehaviorDomain, string> = {
    sap_crm_iys: 'SAP CRM - IYS entegrasyonu',
    sap_crm_ai_sales_bot: 'SAP CRM AI satis botu',
    digital_contract: 'Dijital sozlesme',
    integration_project: 'Entegrasyon projesi',
    crm_process: 'CRM sureci',
    document_management: 'Dokuman yonetimi',
    generic_ba: 'Genel is analizi',
  };
  return labels[domain];
}

function isFocusedArtifactRequest(classification: IntentClassification): boolean {
  return ['test', 'flow', 'review', 'quality'].includes(String(classification.baAgentFocus || ''))
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
    ].includes(String(classification.subIntent || ''));
}

function inferUserIntent(decision: Omit<BehaviorDecision, 'humanProfile'>, context: DecisionContext): BehaviorUserIntent {
  if (decision.mode === 'chat_only') return 'small_talk';
  if (context.contextFollowUp || context.forceDraft || context.stopQuestions) return 'continuation';
  if (context.hasExistingDocument && decision.shouldUpdateDocument) return 'document_revision';
  if (decision.mode === 'ask_clarifying_questions' && context.strongDomainRequest) return 'new_project_idea';
  if (context.explicitDocumentGeneration || decision.mode === 'draft_with_assumptions') return 'explicit_document_generation';
  if (decision.domain !== 'generic_ba') return 'new_project_idea';
  return 'unknown';
}

function buildHumanBaProfile(decision: Omit<BehaviorDecision, 'humanProfile'>, context: DecisionContext): HumanBaProfile {
  const questionStrategy: BehaviorQuestionStrategy = decision.mode === 'ask_clarifying_questions'
    ? (decision.domain === 'generic_ba' ? 'critical_gap_only' : 'domain_discovery')
    : (decision.shouldUseAssumptions ? 'assumption_first' : 'none');
  const documentAction: BehaviorDocumentAction = decision.shouldUpdateDocument
    ? (context.hasExistingDocument ? 'update_existing_document' : 'create_conceptual_draft')
    : (decision.mode === 'suggest_next_step' ? 'suggest_next_step' : 'none');
  const assumptionPolicy: BehaviorAssumptionPolicy = decision.shouldUseAssumptions && decision.shouldUpdateDocument
    ? 'draft_with_marked_assumptions'
    : (decision.shouldUseAssumptions ? 'mark_noncritical_assumptions' : 'do_not_assume');
  const label = domainLabel(decision.domain);
  const recommendedNextAction = decision.mode === 'ask_clarifying_questions'
    ? `${label} icin kritik kararlari netlestir; kullanici isterse "Varsayimlarla ilerle" sinyaliyle ilk taslagi uret.`
    : decision.shouldUpdateDocument
      ? `${label} icin dokumani guncelle; bilinmeyenleri [VARSAYIM] ve [ACIK KONU] olarak ayir.`
      : context.contextFollowUp
        ? 'Son baglama gore sonraki en iyi aksiyonu oner; yeni soru seti acma.'
        : 'Baglamdan sonraki en iyi BA aksiyonunu oner.';

  return {
    userIntent: inferUserIntent(decision, context),
    projectDomain: decision.domain,
    missingCriticalInfo: decision.mode === 'ask_clarifying_questions' ? buildCriticalInfoForDomain(decision.domain).slice(0, decision.questionBudget || 3) : [],
    questionRationale: decision.mode === 'ask_clarifying_questions' ? buildDiscoveryRationalesForDomain(decision.domain).slice(0, decision.questionBudget || 3) : [],
    recommendedNextAction,
    questionStrategy,
    documentAction,
    assumptionPolicy,
    responseStance: decision.mode === 'ask_clarifying_questions'
      ? 'Kisa, dogal ve domain farkindaligi olan bir giris yap; genel BA sorulari yerine kritik karar sorularini sor.'
      : decision.shouldUpdateDocument
        ? 'Ne yapildigini, hangi varsayimlarla ilerledigini ve kalan acik konulari net soyle; detaylari sag panele yaz.'
        : 'Baglama gore sonraki en iyi adimi oner.',
  };
}

function finalizeDecision(decision: Omit<BehaviorDecision, 'humanProfile'>, context: DecisionContext): BehaviorDecision {
  return {
    ...decision,
    humanProfile: buildHumanBaProfile(decision, context),
  };
}

export function buildBehaviorDecision(input: BehaviorDecisionInput): BehaviorDecision {
  const message = input.userMessage || '';
  const normalizedMessage = normalizeDomainText(message);
  const domain = detectDomain(message);
  const hasExistingDocument = hasDocument(input.document);
  const forceDraft = hasAny(normalizedMessage, FORCE_DRAFT_TERMS);
  const stopQuestions = hasAny(normalizedMessage, STOP_QUESTION_TERMS);
  const contextFollowUp = hasAny(normalizedMessage, CONTEXT_FOLLOW_UP_TERMS);
  const strongDomainRequest = domain !== 'generic_ba' && domain !== 'crm_process';
  const explicitDocumentGeneration = hasAny(normalizedMessage, EXPLICIT_GENERATION_TERMS) || forceDraft || stopQuestions;
  const documentRequest = hasAny(normalizedMessage, DOCUMENT_TERMS)
    || strongDomainRequest
    || input.classification.documentImpact === 'updates_document'
    || (hasExistingDocument && (forceDraft || stopQuestions));
  const shortDomainRequest = message.trim().length < 80 && documentRequest && !forceDraft && !hasExistingDocument;
  const focusedArtifactRequest = isFocusedArtifactRequest(input.classification);
  const readiness = input.discoveryReadiness ?? 0;
  const shouldDiscoverDomainBeforeDraft = strongDomainRequest
    && documentRequest
    && !hasExistingDocument
    && !forceDraft
    && !stopQuestions
    && !focusedArtifactRequest
    && readiness < 55;
  const shouldAskOnlyIfCritical = shortDomainRequest && readiness < 35 && !strongDomainRequest && !focusedArtifactRequest;
  const context: DecisionContext = {
    hasExistingDocument,
    forceDraft,
    stopQuestions,
    explicitDocumentGeneration,
    strongDomainRequest,
    contextFollowUp,
  };

  if (isGreetingOnly(normalizedMessage)) {
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
    }, context);
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
    }, context);
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
    }, context);
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
      shouldUseResearch: domain !== 'generic_ba',
      questionBudget: 4,
      clarificationQuestions: buildDomainQuestions(domain),
      confidence: 0.86,
      reason: `behavior:domain_discovery_before_draft:${domain}`,
    }, context);
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
    }, context);
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
    }, context);
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
  }, context);
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
      targetSection: classification.targetSection || 'businessAnalysis',
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
