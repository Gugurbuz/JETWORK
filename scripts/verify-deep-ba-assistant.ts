import {
  buildDeepBaActInstructions,
  buildDeepBaResearchPlan,
  buildSourceVerificationPolicy,
  parseClassifierQuestion,
  requiresExternalKnowledge,
  shouldUseDeepBaAssistant,
} from '../src/modules/deep-ba-assistant';
import { buildClassification, normalizeBaClassifierOutput } from '../src/services/ai/intentClassifier';
import { detectBaDiscoveryDomain } from '../src/services/ai/baDiscoveryProfiles';
import {
  applyBehaviorDecisionToClassification,
  buildBehaviorDecision,
  buildDomainQuestions,
  shouldPauseForBehaviorDiscovery,
} from '../src/services/ai/behaviorDecision';
import {
  BA_MINDSET_CHECKLIST,
  buildBaMindsetInstruction,
  buildBaMindsetQuestions,
} from '../src/services/ai/baMindset';
import { buildBaCognitiveFrame } from '../src/services/ai/baCognitiveFrame';
import { buildAiTurnDecision } from '../src/services/ai/aiTurnDecision';
import {
  buildCopilotCognitiveInstruction,
  buildCopilotCognitiveTrace,
  buildCopilotReviewMarkdown,
} from '../src/services/ai/copilotCognitiveArchitecture';
import {
  buildCopilotRuntimeInstruction,
  buildCopilotRuntimeReviewMarkdown,
  buildCopilotRuntimeSnapshot,
} from '../src/services/ai/copilotRuntimeState';
import {
  buildProjectMemoryContext,
  extractProjectMemoryUpdates,
  mergeProjectMemory,
} from '../src/services/ai/projectMemoryEngine';
import { DRAFT_FIRST_SYSTEM_RULE, computeDiscoverySignals, detectSignals } from '../src/services/ai/discoveryPolicy';
import { INTENT_DEFAULTS, SLASH_COMMAND_MAP } from '../src/services/ai/intentTypes';
import {
  CONCEPTUAL_TEMPLATE_PROMPT,
  conceptualTemplateCoverage,
  ensureConceptualTemplateStructure,
  isConceptualTemplateCompliant,
} from '../src/services/conceptualTemplate';
import { evaluateDocumentQualityGate } from '../src/services/documentQualityGate';
import {
  analyzeSourceIntelligence,
  buildSourceIntelligencePrompt,
  buildSourceIntelligenceReviewMarkdown,
  buildSourceVerificationMatrixMarkdown,
} from '../src/services/sourceIntelligence';
import { postProcessDocumentData } from '../src/services/documentPostProcessor';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertIncludes(value: string, needle: string, message: string): void {
  assert(value.includes(needle), `${message}: expected "${needle}"`);
}

const sapIysRequest = 'sap crm iys entegrasyonu ba analiz kavramsal tasarim dokumani';
const shortSapIysRequest = 'sap crm iys entegrasyonu';
const sapCrmAiSalesBotRequest = 'sap crm ai satis botu projesi';
const realSapCrmAiSalesBotRequest = 'sap crm ai satış botu projesi';
const assumptionFollowUp = 'sap crm iys entegrasyonu\nVarsayımlarla ilerle. Tamamlanacak bilgileri tahmini olarak doldur.';

assert(shouldUseDeepBaAssistant(sapIysRequest), 'SAP CRM + IYS request should activate deep BA mode');
assert(requiresExternalKnowledge(sapIysRequest), 'SAP CRM + IYS request should require external knowledge');
assert(shouldUseDeepBaAssistant(sapCrmAiSalesBotRequest), 'SAP CRM AI sales bot request should activate deep BA mode');
assert(requiresExternalKnowledge(sapCrmAiSalesBotRequest), 'SAP CRM AI sales bot request should require external knowledge');

const researchPlan = buildDeepBaResearchPlan(sapIysRequest);
assert(researchPlan.enabled, 'Deep BA research plan should be enabled');
assert(researchPlan.searchQueries.some((query) => /site:iys\.org\.tr/i.test(query)), 'Research queries should prefer official IYS sources');
assert(researchPlan.searchQueries.some((query) => /site:mevzuat\.gov\.tr/i.test(query)), 'Research queries should prefer official legislation sources');
assert(researchPlan.searchQueries.some((query) => /site:ahsdocs\.iys\.org\.tr/i.test(query)), 'Research queries should prefer official IYS API documentation');
assert(researchPlan.searchQueries.some((query) => /site:ticaret\.gov\.tr/i.test(query)), 'Research queries should prefer official Ministry IYS sources');
assert(researchPlan.searchQueries.some((query) => /3 is gunu/i.test(query)), 'Research queries should cover the 3 business day rule');
assert(researchPlan.searchQueries.some((query) => /recipientType/i.test(query)), 'Research queries should cover IYS API fields');
assert(researchPlan.documentGapsToCheck.some((gap) => /artifact modu.*profil/i.test(gap)), 'Research planning should validate artifact profile alignment');
assert(researchPlan.documentGapsToCheck.some((gap) => /DOGRULANDI.*VARSAYIM.*ACIK KONU/i.test(gap)), 'Research planning should validate evidence status separation');
assert(!researchPlan.documentGapsToCheck.some((gap) => /BR\/FR\/NFR\/INT|dogrulama matrisi/i.test(gap)), 'Research planning must not impose a parallel document template');

const crmAiSalesResearchPlan = buildDeepBaResearchPlan(sapCrmAiSalesBotRequest);
assert(crmAiSalesResearchPlan.enabled, 'SAP CRM AI sales bot research plan should be enabled');
assert(crmAiSalesResearchPlan.searchQueries.some((query) => /help\.sap\.com/i.test(query)), 'SAP CRM AI sales bot research should prefer SAP Help sources');
assert(crmAiSalesResearchPlan.searchQueries.some((query) => /Business AI|Joule|lead qualification/i.test(query)), 'SAP CRM AI sales bot research should cover AI sales assistant context');

const sourcePolicy = buildSourceVerificationPolicy(sapIysRequest);
assert(sourcePolicy.requiresSourceSeparation, 'SAP IYS source policy should require verified/assumption/open-topic separation');
assert(sourcePolicy.statusLabels.includes('DOGRULANDI'), 'Source policy should include verified status');
assert(sourcePolicy.statusLabels.includes('VARSAYIM'), 'Source policy should include assumption status');
assert(sourcePolicy.statusLabels.includes('ACIK KONU'), 'Source policy should include open-topic status');
assert(sourcePolicy.preferredSources.some((source) => /ahsdocs\.iys\.org\.tr/i.test(source)), 'Source policy should prefer official IYS AHS API docs');
assert(sourcePolicy.preferredSources.some((source) => /Ticaret Bakanligi/i.test(source)), 'Source policy should prefer Ministry sources');
const crmAiSalesSourcePolicy = buildSourceVerificationPolicy(sapCrmAiSalesBotRequest);
assert(crmAiSalesSourcePolicy.requiresSourceSeparation, 'SAP CRM AI sales bot source policy should require source separation');
assert(crmAiSalesSourcePolicy.preferredSources.some((source) => /SAP Help/i.test(source)), 'SAP CRM AI sales bot source policy should prefer SAP Help');
const kkbFindeksRequest = 'sap crm musteri verisi ile KKB Findeks API entegrasyonu kavramsal dokuman hazirla';
const kkbFindeksPlan = buildDeepBaResearchPlan(kkbFindeksRequest);
const kkbFindeksInstructions = buildDeepBaActInstructions(kkbFindeksRequest);
assert(detectBaDiscoveryDomain(kkbFindeksRequest) === 'integration_project', 'KKB/Findeks request should use integration discovery, not CRM AI sales bot discovery');
assert(!kkbFindeksPlan.searchQueries.some((query) => /lead qualification|Business AI|Joule/i.test(query)), 'KKB/Findeks research plan should not inherit CRM AI sales bot research queries');
assert(!/lead yakalama|opportunity olusturma|AI davranis kurallarini/i.test(kkbFindeksInstructions), 'KKB/Findeks instructions should not include CRM AI sales bot addendum');
[
  'generate_technical_analysis',
  'generate_integration_analysis',
  'generate_api_contract',
  'generate_error_scenarios',
  'generate_test_cases',
  'generate_flow_diagram',
  'generate_bpmn',
  'generate_mermaid',
  'generate_developer_handoff',
  'check_testability',
  'check_traceability',
  'check_integration_completeness',
].forEach((subIntent) => {
  assert((INTENT_DEFAULTS as any)[subIntent]?.targetSection === 'businessAnalysis', `${subIntent} should stay on the visible BA document surface`);
});
['/test', '/flow', '/bpmn', '/mermaid', '/api'].forEach((command) => {
  assert((SLASH_COMMAND_MAP as any)[command]?.target === 'businessAnalysis', `${command} should route to BA Analiz, not hidden code/test/bpmn tabs`);
});

const baMindsetInstruction = buildBaMindsetInstruction({
  mode: 'draft_with_assumptions',
  domain: 'sap_crm_ai_sales_bot',
  depth: 'deep',
});
assertIncludes(baMindsetInstruction, 'BA MINDSET', 'BA mindset instruction should be explicit');
assertIncludes(baMindsetInstruction, 'Problem / is ihtiyaci', 'BA mindset should check problem and need');
assertIncludes(baMindsetInstruction, 'Is degeri / KPI', 'BA mindset should check business value and KPI');
assertIncludes(baMindsetInstruction, 'Sistem davranisi / ekran / veri', 'BA mindset should check system behavior, screens and data');
assertIncludes(baMindsetInstruction, 'kritik degilse varsayim', 'BA mindset should prefer assumptions when information is not critical');
assertIncludes(baMindsetInstruction, 'Insansi BA refleksi', 'BA mindset should include human-like BA reflexes');
assertIncludes(baMindsetInstruction, 'Kullanici elestirirse savunmaya gecme', 'BA mindset should handle user criticism without defensiveness');
assert(BA_MINDSET_CHECKLIST.length >= 9, 'BA mindset checklist should cover BA responsibilities end to end');
const genericMindsetQuestions = buildBaMindsetQuestions('generic_ba');
assert(genericMindsetQuestions.length === 3, 'Generic BA mindset should ask at most three focused questions');
assert(genericMindsetQuestions.some((item) => /Ana is problemi/i.test(item)), 'Generic BA mindset questions should ask about the business problem');
assertIncludes(DRAFT_FIRST_SYSTEM_RULE, 'BA MINDSET', 'Draft-first system rule should include BA mindset policy');
assertIncludes(DRAFT_FIRST_SYSTEM_RULE, 'Insansi BA refleksi', 'Draft-first system rule should include human-like BA behavior');
assertIncludes(DRAFT_FIRST_SYSTEM_RULE, 'otomatik doküman komutu sayma', 'Draft-first system rule should distinguish project ideas from document commands');
assert(detectSignals('tamam next sen yap').forceGenerate, 'Continuation signals should force generation');
assert(detectSignals('ben mi yapicam soru sorma').stopQuestions, 'User refusal to do the work should stop questions');
assert(!detectSignals('sap crm ai satis botu projesi kavramsal tasarim dokumani hazirla').forceGenerate, 'Document output wording alone should not force generation');
assert(detectSignals('sap crm ai satis botu projesi varsayimlarla ilk taslagi cikar').forceGenerate, 'Explicit assumption draft wording should force generation');
assert(!computeDiscoverySignals('sap crm ai satis botu projesi kavramsal tasarim dokumani hazirla', [], null).mustGenerateNow, 'Sparse initial CRM AI sales bot document request should not be forced into draft generation');
const pendingQuestionMessages = [
  {
    id: 'ai-q1',
    role: 'model',
    text: 'Devam etmeden once sorulari netlestirelim.',
    questions: [{ id: 'q1', text: 'IYS kapsami nedir?', options: ['SMS', 'Tum kanallar'] }],
  },
] as any;
const newD2dSignals = computeDiscoverySignals('SAHA SATIS UYGULAMAMIZ D2D UN MOBILE DONUSUMU ICIN REFACTORING', pendingQuestionMessages, null);
assert(newD2dSignals.newStandaloneRequest, 'A fresh D2D project request after pending questions should be detected as a new standalone request');
assert(!newD2dSignals.mustGenerateNow, 'A fresh D2D project request must not be treated as an answer to old discovery questions');

const actInstructions = buildDeepBaActInstructions(sapIysRequest);
assertIncludes(actInstructions, 'AiTurnDecision icindeki artifact profile tek yapisal otoritedir', 'Deep instructions must defer document structure to the central decision contract');
assertIncludes(actInstructions, 'Profilde olmayan teknik analiz', 'Deep instructions must prevent cross-profile section injection');
assert(!/businessAnalysis\.content su omurgayi|1\. Calisma ozeti|BR\/FR\/NFR\/INT\/RPT\/SEC kodlu gereksinimler/i.test(actInstructions), 'Deep instructions must not impose a parallel generic BA template');
assert(!/3 is gunu|\bMESAJ\b|\bEPOSTA\b|\bARAMA\b|\brecipient\b/i.test(actInstructions), 'Act instructions must not inject unverified IYS facts before research');
assertIncludes(actInstructions, 'DOGRULANDI', 'Deep instructions should separate verified claims');
assertIncludes(actInstructions, 'VARSAYIM', 'Deep instructions should separate assumptions');
assertIncludes(actInstructions, 'ACIK KONU', 'Deep instructions should separate open topics');
const crmAiSalesActInstructions = buildDeepBaActInstructions(sapCrmAiSalesBotRequest);
assert(!/lead yakalama|opportunity olusturma|temsilciye devir/i.test(crmAiSalesActInstructions), 'Act instructions must not inject a ready-made CRM sales process');
assertIncludes(crmAiSalesActInstructions, 'DOGRULANDI', 'CRM AI instructions should enforce evidence status separation');

const sapDomainQuestions = buildDomainQuestions('sap_crm_iys');
assert(sapDomainQuestions.length >= 4, 'SAP IYS behavior profile should expose at least 4 domain questions');
assert(sapDomainQuestions.some((item) => /marka/i.test(item)), 'SAP IYS domain questions should ask about brand code structure');
assert(sapDomainQuestions.some((item) => /Initial load/i.test(item)), 'SAP IYS domain questions should ask about initial load and delta scope');
assert(sapDomainQuestions.every((item) => /Neden:/i.test(item) && /Dokumana etkisi:/i.test(item)), 'SAP IYS questions should explain rationale and document impact');
const crmAiSalesDomainQuestions = buildDomainQuestions('sap_crm_ai_sales_bot');
assert(crmAiSalesDomainQuestions.length >= 4, 'SAP CRM AI sales bot behavior profile should expose at least 4 domain questions');
assert(crmAiSalesDomainQuestions.some((item) => /kanal/i.test(item)), 'CRM AI sales bot questions should ask about channels');
assert(crmAiSalesDomainQuestions.some((item) => /Lead \+ Opportunity/i.test(item)), 'CRM AI sales bot questions should ask about CRM sales objects');
assert(crmAiSalesDomainQuestions.every((item) => /Neden:/i.test(item) && /Dokumana etkisi:/i.test(item)), 'CRM AI sales bot questions should explain rationale and document impact');
assert(crmAiSalesDomainQuestions.some((item) => /audit|insan onayi|temsilci devri/i.test(item)), 'CRM AI sales bot questions should expose governance and handoff impact');
const fieldMobileQuestions = buildDomainQuestions('field_mobile_app');
assert(fieldMobileQuestions.length >= 4, 'Field mobile app profile should expose at least 4 archetype questions');
assert(fieldMobileQuestions.some((item) => /offline-first|Offline/i.test(item)), 'Field mobile app questions should ask about offline-first behavior');
assert(fieldMobileQuestions.some((item) => /cihaz|kamera|konum/i.test(item)), 'Field mobile app questions should ask about device and mobile UI behavior');
assert(fieldMobileQuestions.every((item) => /Neden:/i.test(item) && /Dokumana etkisi:/i.test(item)), 'Field mobile app questions should explain rationale and document impact');
const aiAssistantQuestions = buildDomainQuestions('ai_assistant_product');
assert(aiAssistantQuestions.some((item) => /kaynak|hafiza|kanit/i.test(item)), 'AI assistant product questions should ask about source, memory and evidence policy');
assert(aiAssistantQuestions.some((item) => /arac|Tool|aksiyon/i.test(item)), 'AI assistant product questions should ask about tool authority');
const parsedCrmDiscoveryQuestion = parseClassifierQuestion(crmAiSalesDomainQuestions[0], 0);
assert(parsedCrmDiscoveryQuestion.options.length >= 3, 'Profiled discovery question should still parse quick options');
assert(!/Neden:|Dokumana etkisi:/i.test(parsedCrmDiscoveryQuestion.text), 'Parsed profiled question should keep chat question text clean');

const shortBehavior = buildBehaviorDecision({
  userMessage: shortSapIysRequest,
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_integration_analysis', {
    confidence: 0.65,
    reason: 'short_sap_iys',
  }),
});
assert(shortBehavior.mode === 'ask_clarifying_questions', 'Short SAP IYS request should ask domain discovery questions before drafting');
assert(shortBehavior.domain === 'sap_crm_iys', 'Short SAP IYS request should detect sap_crm_iys domain');
assert(shortBehavior.requiredTemplate === 'corporate_conceptual_design', 'Short SAP IYS request should still bind to corporate template');
assert(!shortBehavior.shouldUpdateDocument, 'Short SAP IYS request should not update the document before discovery or force-draft signal');
assert(shortBehavior.shouldAskQuestions, 'Short SAP IYS request should ask targeted questions when the need is not clear');
assert(shortBehavior.questionBudget === 3, 'Short SAP IYS request should allow at most three domain discovery questions');
assert(shortBehavior.clarificationQuestions.some((item) => /marka/i.test(item)), 'Short SAP IYS request should ask IYS-specific questions');
assert(shortBehavior.humanProfile.userIntent === 'new_project_idea', 'Short SAP IYS request should be treated as a new project idea');
assert(shortBehavior.humanProfile.questionStrategy === 'domain_discovery', 'Short SAP IYS request should use domain discovery strategy');
assert(shortBehavior.humanProfile.assumptionPolicy === 'do_not_assume', 'Short SAP IYS request should not assume before discovery');
assert(shortBehavior.humanProfile.missingCriticalInfo.some((item) => /Marka kodu/i.test(item)), 'Short SAP IYS human profile should name critical missing info');

const crmAiSalesBehavior = buildBehaviorDecision({
  userMessage: sapCrmAiSalesBotRequest,
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.65,
    reason: 'short_crm_ai_sales_bot',
  }),
});
assert(crmAiSalesBehavior.mode === 'ask_clarifying_questions', 'Short SAP CRM AI sales bot request should ask domain discovery questions before drafting');
assert(crmAiSalesBehavior.domain === 'sap_crm_ai_sales_bot', 'Short SAP CRM AI sales bot request should detect sap_crm_ai_sales_bot domain');
assert(!crmAiSalesBehavior.shouldUpdateDocument, 'Short SAP CRM AI sales bot request should not update the document before discovery or force-draft signal');
assert(crmAiSalesBehavior.shouldAskQuestions, 'Short SAP CRM AI sales bot request should ask targeted questions when the need is not clear');
assert(crmAiSalesBehavior.clarificationQuestions.some((item) => /Lead \+ Opportunity/i.test(item)), 'CRM AI sales bot request should ask about sales objects');
assert(crmAiSalesBehavior.humanProfile.userIntent === 'new_project_idea', 'CRM AI sales bot should be treated as a new project idea');
assert(crmAiSalesBehavior.humanProfile.questionStrategy === 'domain_discovery', 'CRM AI sales bot should use domain discovery strategy');
assert(crmAiSalesBehavior.humanProfile.missingCriticalInfo.some((item) => /SAP CRM satis nesneleri/i.test(item)), 'CRM AI sales bot profile should name sales object gap');
assert(crmAiSalesBehavior.humanProfile.questionRationale.some((item) => /CRM|Lead|Opportunity|Activity|kanal/i.test(item)), 'CRM AI sales bot profile should carry question rationale');
assert(/Varsayimlarla ilerle/i.test(crmAiSalesBehavior.humanProfile.recommendedNextAction), 'CRM AI sales bot profile should keep assumption-forward escape hatch');

const fieldMobileBehavior = buildBehaviorDecision({
  userMessage: 'SAHA SATIS UYGULAMAMIZ D2D UN MOBILE DONUSUMU ICIN REFACTORING',
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.65,
    reason: 'field_mobile_sparse_request',
  }),
});
assert(fieldMobileBehavior.domain === 'field_mobile_app', 'D2D mobile transformation request should detect the field mobile app archetype');
assert(fieldMobileBehavior.mode === 'ask_clarifying_questions', 'Sparse field mobile app request should ask targeted discovery questions');
assert(fieldMobileBehavior.clarificationQuestions.some((item) => /offline-first|Offline/i.test(item)), 'Field mobile app discovery should ask about offline-first behavior');
assert(fieldMobileBehavior.humanProfile.missingCriticalInfo.some((item) => /Offline-first|senkronizasyon/i.test(item)), 'Field mobile app profile should name sync/offline critical info');

const aiAssistantProductBehavior = buildBehaviorDecision({
  userMessage: 'jetwork ai sohbet derinligi ve yetenekleri maksimize edilsin',
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.65,
    reason: 'ai_assistant_product_sparse_request',
  }),
});
assert(aiAssistantProductBehavior.domain === 'ai_assistant_product', 'AI assistant depth request should detect AI assistant product archetype');
assert(aiAssistantProductBehavior.clarificationQuestions.some((item) => /kaynak|hafiza|kanit/i.test(item)), 'AI assistant product discovery should ask about source, memory and evidence');

const explicitCrmAiSalesDocumentBehavior = buildBehaviorDecision({
  userMessage: 'sap crm ai satis botu projesi kavramsal tasarim dokumani hazirla',
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.65,
    reason: 'explicit_crm_ai_sales_bot_document',
  }),
});
assert(explicitCrmAiSalesDocumentBehavior.mode === 'ask_clarifying_questions', 'Document output wording without assumption permission should still ask discovery questions');
assert(!explicitCrmAiSalesDocumentBehavior.shouldUpdateDocument, 'Document output wording alone should not update the document before discovery');
assert(explicitCrmAiSalesDocumentBehavior.shouldAskQuestions, 'Document output wording should ask targeted questions when critical BA context is missing');
assert(explicitCrmAiSalesDocumentBehavior.humanProfile.userIntent === 'new_project_idea', 'Document output wording should be understood as a project idea needing discovery');
assert(explicitCrmAiSalesDocumentBehavior.humanProfile.questionStrategy === 'domain_discovery', 'Document output wording should use domain discovery strategy');
assert(explicitCrmAiSalesDocumentBehavior.humanProfile.assumptionPolicy === 'do_not_assume', 'Document output wording should not assume critical context by default');
assert(shouldPauseForBehaviorDiscovery(explicitCrmAiSalesDocumentBehavior), 'Orchestrator must pause for behavior discovery before any draft-generation fallback');

const explicitCrmAiSalesHighReadinessBehavior = buildBehaviorDecision({
  userMessage: 'sap crm ai satis botu projesi kavramsal tasarim dokumani hazirla',
  document: null,
  discoveryReadiness: 85,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.9,
    documentImpact: 'updates_document',
    reason: 'action_intent_generate_conceptual_design',
  }),
});
assert(explicitCrmAiSalesHighReadinessBehavior.mode === 'ask_clarifying_questions', 'Sparse domain document request should ask discovery questions even when readiness is overestimated');
assert(!explicitCrmAiSalesHighReadinessBehavior.shouldUpdateDocument, 'Sparse high-readiness domain request should not produce a document before critical context exists');
assert(shouldPauseForBehaviorDiscovery(explicitCrmAiSalesHighReadinessBehavior), 'Sparse high-readiness domain request should still block forced document generation');

const explicitCrmAiSalesAssumptionDraftBehavior = buildBehaviorDecision({
  userMessage: 'sap crm ai satis botu projesi varsayimlarla ilk taslagi cikar',
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.65,
    reason: 'explicit_crm_ai_sales_bot_assumption_draft',
  }),
});
assert(explicitCrmAiSalesAssumptionDraftBehavior.mode === 'draft_with_assumptions', 'Explicit assumption draft wording should draft with assumptions');
assert(explicitCrmAiSalesAssumptionDraftBehavior.shouldUpdateDocument, 'Explicit assumption draft wording should update the document');
assert(!explicitCrmAiSalesAssumptionDraftBehavior.shouldAskQuestions, 'Explicit assumption draft wording should not pause for questions');
assert(!shouldPauseForBehaviorDiscovery(explicitCrmAiSalesAssumptionDraftBehavior), 'Explicit assumption draft should not be blocked by the discovery pause');
assert(explicitCrmAiSalesAssumptionDraftBehavior.humanProfile.documentAction === 'create_conceptual_draft', 'Explicit assumption draft wording should create a conceptual draft');
assert(explicitCrmAiSalesAssumptionDraftBehavior.humanProfile.assumptionPolicy === 'draft_with_marked_assumptions', 'Explicit assumption draft wording should mark assumptions');

const crmAiSalesFromGenericClassifier = buildBehaviorDecision({
  userMessage: realSapCrmAiSalesBotRequest,
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('ask_summary', {
    confidence: 0.35,
    documentImpact: 'none',
    requiresClarification: true,
    clarificationQuestions: [
      'Çözmek istediğimiz ana iş problemi nedir?',
      'Başarıyı hangi hedef veya iş değeriyle ölçeceğiz?',
    ],
    reason: 'generic_classifier_miss',
  }),
});
assert(crmAiSalesFromGenericClassifier.mode === 'ask_clarifying_questions', 'Real Turkish CRM AI sales bot prompt should override generic classifier miss into domain discovery mode');
assert(crmAiSalesFromGenericClassifier.domain === 'sap_crm_ai_sales_bot', 'Real Turkish CRM AI sales bot prompt should keep domain detection');
assert(!crmAiSalesFromGenericClassifier.shouldUpdateDocument, 'Real Turkish CRM AI sales bot prompt should not produce a document before discovery or assumption signal');
assert(crmAiSalesFromGenericClassifier.shouldAskQuestions, 'Real Turkish CRM AI sales bot prompt should ask contextual BA questions');

const crmAiSalesAppliedClassification = applyBehaviorDecisionToClassification(
  buildClassification('ask_summary', {
    confidence: 0.35,
    documentImpact: 'none',
    requiresClarification: true,
    clarificationQuestions: ['Çözmek istediğimiz ana iş problemi nedir?'],
    reason: 'generic_classifier_miss',
  }),
  crmAiSalesFromGenericClassifier,
  null,
);
assert(!crmAiSalesAppliedClassification.shouldRunBaAgentLoop, 'Behavior decision should pause BA loop for domain discovery');
assert(crmAiSalesAppliedClassification.requiresClarification, 'Behavior decision should replace generic BA questions with contextual domain questions');
assert((crmAiSalesAppliedClassification.clarificationQuestions || []).some((item) => /AI satis botu hangi kanallarda/i.test(item)), 'Behavior decision should provide CRM AI sales bot questions');

const forcedBehavior = buildBehaviorDecision({
  userMessage: assumptionFollowUp,
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_integration_analysis', {
    confidence: 0.65,
    reason: 'sap_iys_assumption_followup',
  }),
});
assert(forcedBehavior.mode === 'draft_with_assumptions', 'Assumption follow-up should enter draft-with-assumptions mode');
assert(!forcedBehavior.shouldAskQuestions, 'Assumption follow-up should suppress more questions');
assert(forcedBehavior.shouldUpdateDocument, 'Assumption follow-up should update the document');
const forcedClassification = applyBehaviorDecisionToClassification(
  buildClassification('generate_integration_analysis', { reason: 'sap_iys_assumption_followup' }),
  forcedBehavior,
  null,
);
assert(forcedClassification.shouldRunBaAgentLoop, 'Behavior-adjusted classification should run BA loop');
assert(!forcedClassification.requiresClarification, 'Behavior-adjusted classification should not require clarification');
assert(forcedClassification.documentImpact === 'updates_document', 'Behavior-adjusted classification should update the document');
assert(forcedClassification.targetSection === 'businessAnalysis', 'Behavior-adjusted classification should target BA Analiz');

const strictContinuationBehavior = buildBehaviorDecision({
  userMessage: 'tamam ok next soru sorma sen yap',
  document: {
    businessAnalysis: {
      content: 'Mevcut BA taslagi',
      status: 'DRAFT' as const,
      flags: [],
    },
  } as any,
  discoveryReadiness: 10,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.3,
    documentImpact: 'none',
    requiresClarification: true,
    clarificationQuestions: ['Problem nedir?'],
    reason: 'generic_question_leak',
  }),
});
assert(strictContinuationBehavior.mode === 'update_existing_document', 'Strict continuation should update existing document');
assert(!strictContinuationBehavior.shouldAskQuestions, 'Strict continuation should suppress questions');
assert(strictContinuationBehavior.shouldUseAssumptions, 'Strict continuation should use assumptions');
assert(strictContinuationBehavior.humanProfile.userIntent === 'continuation', 'Strict continuation should be understood as continuation');
assert(strictContinuationBehavior.humanProfile.documentAction === 'update_existing_document', 'Strict continuation should update the existing document');

const contextFollowUpBehavior = buildBehaviorDecision({
  userMessage: 'simdi?',
  document: {
    businessAnalysis: {
      content: 'Mevcut BA taslagi',
      status: 'DRAFT' as const,
      flags: [],
    },
  } as any,
  discoveryReadiness: 50,
  classification: buildClassification('ask_summary', {
    confidence: 0.45,
    documentImpact: 'none',
    requiresClarification: true,
    clarificationQuestions: ['Ne yapmak istiyorsunuz?'],
    reason: 'generic_follow_up',
  }),
});
assert(contextFollowUpBehavior.mode === 'suggest_next_step', 'Short context follow-up should suggest the next step');
assert(contextFollowUpBehavior.humanProfile.userIntent === 'continuation', 'Short context follow-up should be understood as continuation');
assert(contextFollowUpBehavior.humanProfile.documentAction === 'suggest_next_step', 'Short context follow-up should not update the document directly');
const contextFollowUpClassification = applyBehaviorDecisionToClassification(
  buildClassification('ask_summary', {
    confidence: 0.45,
    documentImpact: 'none',
    requiresClarification: true,
    clarificationQuestions: ['Ne yapmak istiyorsunuz?'],
    reason: 'generic_follow_up',
  }),
  contextFollowUpBehavior,
  null,
);
assert(!contextFollowUpClassification.requiresClarification, 'Short context follow-up should suppress generic questions');
assert(!contextFollowUpClassification.shouldRunBaAgentLoop, 'Short context follow-up should not run BA loop directly');

assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'KAVRAMSAL TASARIM RAPORU', 'Corporate prompt should require the report title');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'PROJE KIMLIK KARTI', 'Corporate prompt should require project identity card');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'Dokuman Tarihcesi', 'Corporate prompt should require document history');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'SUREC MODELI', 'Corporate prompt should require process model blocks');
assert(!/en az\s+\d+\s+adet/i.test(CONCEPTUAL_TEMPLATE_PROMPT), 'Corporate prompt must not impose a fixed process count');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'Ust Duzey Musteri Gelistirmesi', 'Corporate prompt should require development tables');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'EK A', 'Corporate prompt should require appendix A');

const legacyBaDraft = {
  businessAnalysis: {
    content: '# BA Analiz Raporu\n\n## Amaç ve İş Değeri\nSAP CRM İYS entegrasyonu için kısa taslak.\n\n## Kapsam\nİzin aktarımı ve mutabakat.',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: 'Riskler ve açık sorular daha sonra netleştirilecek.',
    status: 'DRAFT' as const,
    flags: [],
  },
};

assert(!isConceptualTemplateCompliant(legacyBaDraft.businessAnalysis.content), 'Legacy BA draft should not pass corporate conceptual template');
const templatedDocument = ensureConceptualTemplateStructure(legacyBaDraft);
const templatedContent = templatedDocument.businessAnalysis.content;
/* Legacy assertions retained for historical context. Automatic repair is intentionally disabled.
assert(isConceptualTemplateCompliant(templatedContent), 'Post processor fallback should produce a compliant conceptual template');
assertIncludes(templatedContent, 'KAVRAMSAL TASARIM RAPORU', 'Fallback should start from conceptual report title');
assertIncludes(templatedContent, 'PROJE KİMLİK KARTI', 'Fallback should include project identity card');
assertIncludes(templatedContent, 'Doküman Tarihçesi', 'Fallback should include document history');
assertIncludes(templatedContent, 'Kontrol EDEN VE ONAYLAYAN', 'Fallback should include approval table');
assertIncludes(templatedContent, 'SÜREÇ TASARIMI', 'Fallback should include process design');
assertIncludes(templatedContent, 'Üst Düzey Müşteri Geliştirmesi', 'Fallback should include development table blocks');
assertIncludes(templatedContent, 'İLGİLİ / REFERANS DOKÜMANLAR', 'Fallback should include reference documents table');
assertIncludes(templatedContent, 'EK A', 'Fallback should include appendix A');
const processModelCount = (templatedContent.match(/SÜREÇ MODELİ - \d+/g) || []).length;
assert(processModelCount >= 3, 'SAP IYS fallback should create at least 3 process model blocks');
assert((templatedDocument.businessAnalysis.flags || []).includes('CONCEPTUAL_TEMPLATE_APPLIED'), 'Fallback should mark conceptual template application');
const coverage = conceptualTemplateCoverage(templatedContent);
assert(coverage.passed >= coverage.total - 2, 'Fallback template should cover almost all required headings');
*/
assert(templatedContent === legacyBaDraft.businessAnalysis.content, 'Template compatibility boundary must not mutate document prose');
assert(!isConceptualTemplateCompliant(templatedContent), 'A weak draft must remain visibly non-compliant until an explicit repair action');
const postProcessedLegacy = postProcessDocumentData(legacyBaDraft as any, null).document;
assertIncludes(postProcessedLegacy.businessAnalysis.content, 'Amaç ve İş Değeri', 'Post processor should preserve model-provided business content');
assert(!/KAVRAMSAL TASARIM RAPORU/i.test(postProcessedLegacy.businessAnalysis.content), 'Post processor must not enforce a conceptual template');
assert(!/Kaynak ve Dogrulama Matrisi|Resmi Kaynak Guard|Word Template Conformance Guard/i.test(postProcessedLegacy.review?.content || ''), 'Post processor must not inject Review prose');
assert((postProcessedLegacy.review?.flags || []).length === 0, 'Post processor must not inject Review flags');
assert(!(postProcessedLegacy.suggestions || []).some(item => /Tamamlanacak alanları kapat/i.test(item)), 'Post processor must not inject quick actions');
assert((postProcessedLegacy.qualityAssessment?.findings || []).length > 0, 'Post processor should expose structured findings');

const sapC4cIysShortDocument = postProcessDocumentData({
  businessAnalysis: {
    content: '# KAVRAMSAL TASARIM RAPORU\n\nKisa entegrasyon taslagi.',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: 'Kisa review.',
    status: 'DRAFT' as const,
    flags: [],
  },
}, null, {
  sourceText: 'SAP CRM C4C E IYS ENTEGRASYONU PROJESI ICIN KAVRAMSAL YAZALIM',
  workspaceTitle: '',
}).document;
const sapC4cIysContent = sapC4cIysShortDocument.businessAnalysis?.content || '';
assert(!/SAP CRM|IYS|İYS/i.test(sapC4cIysContent), 'Quality assessment must not copy source context into the document');
assert(!/Delta|Mutabakat|Retry|Operasyon/i.test(sapC4cIysContent), 'Quality assessment must not invent integration coverage');
assert(!/D2D Saha|Offline-First|Dijital Imza|OTP/i.test(sapC4cIysContent), 'SAP C4C IYS short request should not be contaminated by D2D or digital contract content');
assert((sapC4cIysShortDocument.qualityAssessment?.findings || []).some(item => item.category === 'source'), 'Missing source fidelity should be a structured finding');

const aiSalesFallback = ensureConceptualTemplateStructure({
  businessAnalysis: {
    content: 'sap crm ai satis botu projesi kavramsal tasarim dokumani',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: '',
    status: 'DRAFT' as const,
    flags: [],
  },
});
const aiSalesFallbackContent = aiSalesFallback.businessAnalysis.content;
assert(/sap crm ai satis botu projesi/i.test(aiSalesFallbackContent), 'AI sales bot fallback should preserve the source project phrase');
assert(!/SUREC MODELI|SÜREÇ MODELİ/i.test(aiSalesFallbackContent), 'Read-only template boundary must not invent AI sales process blocks');
assert(/lead|satis|bot|gereksinim|kabul kriter/i.test(aiSalesFallbackContent), 'AI sales bot fallback should keep source signals in the document');
const sourceDrivenD2dFallback = ensureConceptualTemplateStructure({
  businessAnalysis: {
    content: 'SAHA SATIS UYGULAMAMIZ D2D UN MOBILE DONUSUMU ICIN REFACTORING',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: '',
    status: 'DRAFT' as const,
    flags: [],
  },
});
const sourceDrivenD2dContent = sourceDrivenD2dFallback.businessAnalysis.content;
assert(/SAHA SATIS UYGULAMAMIZ D2D/i.test(sourceDrivenD2dContent), 'D2D fallback should preserve the source project phrase');
assert(!/SUREC MODELI|SÜREÇ MODELİ/i.test(sourceDrivenD2dContent), 'Read-only template boundary must not invent D2D process blocks');
assert(!/SAP CRM'den|Dijital Imza|OTP|Kaynak Sistemden Hedef Sisteme Veri Aktar/i.test(sourceDrivenD2dContent), 'D2D fallback should not be contaminated by unrelated fixed-domain content');
/*
assertIncludes(aiSalesFallbackContent, 'SAP CRM AI Satış Botu Projesi', 'SAP CRM AI sales bot fallback should infer the real project name');
assertIncludes(aiSalesFallbackContent, 'AI Bot ile Lead Kazanımı ve Nitelendirme', 'SAP CRM AI sales bot fallback should create a lead qualification process');
assertIncludes(aiSalesFallbackContent, 'Satış Temsilcisine Devir, Handoff ve Opportunity Yönetimi', 'SAP CRM AI sales bot fallback should create a handoff/opportunity process');
assert(!/Kaynak Sistemden Hedef Sisteme Veri Aktarımı/i.test(aiSalesFallbackContent), 'SAP CRM AI sales bot fallback should not use generic integration process names');

const d2dMobileFallback = ensureConceptualTemplateStructure({
  businessAnalysis: {
    content: 'SAHA SATIS UYGULAMAMIZ D2D UN MOBILE DONUSUMU ICIN REFACTORING',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: '',
    status: 'DRAFT' as const,
    flags: [],
  },
});
const d2dMobileContent = d2dMobileFallback.businessAnalysis.content;
assertIncludes(d2dMobileContent, 'D2D Saha Satis Uygulamasi Mobil Donusum ve Refactoring Projesi', 'D2D mobile fallback should infer the field mobile transformation project name');
assertIncludes(d2dMobileContent, 'Saha Ziyaret Planlama, Rota ve Gunluk Gorev Yonetimi', 'D2D mobile fallback should create route/visit process coverage');
assertIncludes(d2dMobileContent, 'Musteri Adayi, Lead, Teklif ve Saha Satis Akisi', 'D2D mobile fallback should create lead/offer/sales process coverage');
assertIncludes(d2dMobileContent, 'Offline-First Veri Toplama, Delta Sync ve Cakisma Yonetimi', 'D2D mobile fallback should create offline sync process coverage');
assertIncludes(d2dMobileContent, 'Belge, Onay, Operasyon Izleme ve Mobil Performans Yonetimi', 'D2D mobile fallback should create document/approval/operations process coverage');
assert(!/SAP CRM'den|Ä°YS'den|Dijital Imza|OTP|Kaynak Sistemden Hedef Sisteme Veri Aktar/i.test(d2dMobileContent), 'D2D mobile fallback should not be contaminated by SAP IYS, digital contract or generic integration processes');
*/
const d2dSourceReport = analyzeSourceIntelligence({
  sourceText: 'SAHA SATIS UYGULAMAMIZ D2D UN MOBILE DONUSUMU ICIN REFACTORING. Offline-first saha satis, rota, lead, teklif ve CRM entegrasyonu bekleniyor.',
  workspaceTitle: '',
});
assert(/SAHA SATIS UYGULAMAMIZ D2D/i.test(d2dSourceReport.inferredProjectName || ''), 'D2D source intelligence should preserve the field mobile source phrase');
assert(d2dSourceReport.domainHints.includes('field_mobile_app'), 'D2D source intelligence should expose field mobile domain hint');
assert(d2dSourceReport.processes.length === 0, 'D2D source intelligence should not invent fixed process rows when the source has no numbered processes');

const richAiSalesDraftContent = `
# KAVRAMSAL TASARIM RAPORU

## PROJE KİMLİK KARTI
SAP CRM AI Satış Botu Projesi

## Doküman Tarihçesi
### Katılımcılar
### Revize tarih
### Kontrol EDEN VE ONAYLAYAN

## İÇİNDEKİLER
- SÜREÇ TASARIMI
- SÜREÇ MODELİ - 1 "AI Bot ile Lead Kazanımı ve Nitelendirme"
- SÜREÇ MODELİ - 2 "Satış Temsilcisine Devir ve Opportunity Yönetimi"
- SÜREÇ MODELİ - 3 "AI İzleme ve Performans Yönetimi"

## SÜREÇ TASARIMI
Satış botu lead toplama, nitelendirme, SAP CRM kayıt açma ve temsilciye devir kapsamını yönetir.

## 1. SÜREÇ MODELİ - 1 "AI Bot ile Lead Kazanımı ve Nitelendirme"
### Üst Düzey Süreç Açıklaması
### Süreç değişiklikleri
### İş Gerekleri ve KPIs
| Kod | Açıklama |
|---|---|
| BR-01 | Bot niyet analizi yapar. |
| FR-01 | SAP CRM Lead kaydı açılır. |
### Detaylı Süreç Akışı
### İlgili Süreçler
### Üst Düzey Müşteri Geliştirmesi
| Geliştirme No | Tip |
|---|---|
| GEL-101 | Bot servisi |
### Önemli Uyarlamalar ve Amaçları
### Değişim Yönetimi

## 2. SÜREÇ MODELİ - 2 "Satış Temsilcisine Devir ve Opportunity Yönetimi"
### İş Gerekleri ve KPIs
| Kod | Açıklama |
|---|---|
| BR-02 | Handoff özeti CRM'e yazılır. |

## 3. SÜREÇ MODELİ - 3 "AI İzleme ve Performans Yönetimi"
### İş Gerekleri ve KPIs
| Kod | Açıklama |
|---|---|
| NFR-01 | Yanıt süresi izlenir. |
`.trim();
const richAiSalesDraft = {
  businessAnalysis: {
    content: richAiSalesDraftContent,
    status: 'DRAFT' as const,
    flags: [],
  },
};
const richAiSalesProcessed = ensureConceptualTemplateStructure(richAiSalesDraft);
assert(richAiSalesProcessed.businessAnalysis.content === richAiSalesDraftContent, 'Rich domain-specific conceptual drafts should not be rewrapped by generic fallback');
assert(!/Kaynak Sistemden Hedef Sisteme Veri Aktarımı/i.test(richAiSalesProcessed.businessAnalysis.content), 'Rich SAP CRM AI sales bot drafts should not get generic integration blocks appended');

const pempRequest = `
Talep Dokumani
MUSTERI COZUMLERI PROJE YONETIM SISTEMI
PEMP-1157
Sozlesmenin imzalanmasi sonrasi proje takip sistemi olusturulacaktir.
Surec 0 - Proje Kaydinin olusturulmasi
Surec 1 - Teminat
Surec 2 - Satinalma
Surec 3 - Alt Yuklenici Islemleri
Surec 4 - Musteri Islemleri
Surec 5 - Kurulum
Surec 6 - GES Kabul Islemleri
Surec7 - Faturalama Islemleri SAP'den bilgi ve belge akisi olmalidir
Surec8 - Bakim Islemleri
Genel Dashboard ve proje bazli Dashboard uzerinde deadline, kapasite, zorunlu evrak ve acik gorevler izlenmelidir.
`;

const pempSourceReport = analyzeSourceIntelligence({
  sourceText: pempRequest,
  workspaceTitle: 'sap crm iys entegrasyonu',
});
assert(pempSourceReport.processes.length === 9, 'Source intelligence should extract all PEMP P0-P8 process blocks');
assert(/MUSTERI COZUMLERI PROJE YONETIM SISTEMI/i.test(pempSourceReport.inferredProjectName || ''), 'Source intelligence should preserve PEMP source project name');
/*
assert(pempSourceReport.inferredProjectName === 'Müşteri Çözümleri Proje Yönetim Sistemi (PEMP-1157)', 'Source intelligence should infer PEMP project name');
*/
assert(pempSourceReport.dashboardNeeds.some(item => /Dashboard/i.test(item)), 'Source intelligence should extract dashboard needs');
assert(pempSourceReport.documentRules.some(item => /evrak|belge|doküman|dokuman/i.test(item)), 'Source intelligence should extract mandatory document rules');
assert(pempSourceReport.mismatchWarnings.length >= 1, 'Source intelligence should warn when workspace title conflicts with source document');
const pempSourcePrompt = buildSourceIntelligencePrompt(pempSourceReport);
assertIncludes(pempSourcePrompt, 'Bakim Islemleri', 'Source intelligence prompt should include maintenance process');
/*
assertIncludes(pempSourcePrompt, 'Kaynak doküman, workspace başlığı', 'Source intelligence prompt should make source document primary');
assertIncludes(pempSourcePrompt, 'Bakım İşlemleri', 'Source intelligence prompt should include maintenance process');
*/
const pempSourceReview = buildSourceIntelligenceReviewMarkdown(pempSourceReport);
const pempVerificationMatrix = buildSourceVerificationMatrixMarkdown(pempSourceReport);
assertIncludes(pempSourceReview, 'Hızlı Aksiyonlar', 'Source intelligence review should expose quick actions');
assertIncludes(pempSourceReview, 'Word formatına düzelt', 'Source intelligence review should include Word-format quick action');

assertIncludes(pempVerificationMatrix, 'Kaynak ve Dogrulama Matrisi', 'Source intelligence should build a verification matrix');
assertIncludes(pempVerificationMatrix, 'DOGRULANDI', 'Verification matrix should include verified status');
assertIncludes(pempVerificationMatrix, 'VARSAYIM', 'Verification matrix should include assumption status');
assertIncludes(pempVerificationMatrix, 'ACIK KONU', 'Verification matrix should include open-topic status');
assertIncludes(pempSourceReview, 'Kaynak ve Dogrulama Matrisi', 'Source review should embed the verification matrix');

const productMindClassification = buildClassification('generate_business_analysis', {
  confidence: 0.9,
  documentImpact: 'updates_document',
  reason: 'product_mind_pemp_trace',
});
const productMindBehavior = buildBehaviorDecision({
  userMessage: `${pempRequest}\nBA analiz dokümanını hazırla.`,
  document: null,
  discoveryReadiness: 80,
  classification: productMindClassification,
});
const productMindFrame = buildBaCognitiveFrame({
  userMessage: pempRequest,
  recentConversation: '',
  document: null,
  sourceReport: pempSourceReport,
  behaviorDecision: productMindBehavior,
});
const productMindTurnDecision = buildAiTurnDecision({
  userMessage: pempRequest,
  document: null,
  classification: productMindClassification,
  behaviorDecision: productMindBehavior,
  cognitiveFrame: productMindFrame,
  sourceReport: pempSourceReport,
  discoverySignals: {
    mustGenerateNow: false,
    greetingOnly: false,
    newStandaloneRequest: true,
    reason: 'test_product_mind',
  },
  hasSelectedText: false,
});
const productMindTrace = buildCopilotCognitiveTrace({
  userMessage: pempRequest,
  messages: [],
  knowledgeBase: [],
  document: null,
  hasSelectedText: false,
  classification: productMindClassification,
  behaviorDecision: productMindBehavior,
  sourceReport: pempSourceReport,
  cognitiveFrame: productMindFrame,
  turnDecision: productMindTurnDecision,
  discoverySignals: {
    mustGenerateNow: false,
    greetingOnly: false,
    newStandaloneRequest: true,
    reason: 'test_product_mind',
  },
});
const productMindInstruction = buildCopilotCognitiveInstruction(productMindTrace);
const productMindReview = buildCopilotReviewMarkdown(productMindTrace);
const productMindRuntime = buildCopilotRuntimeSnapshot({
  userMessage: pempRequest,
  messages: [],
  knowledgeBase: [],
  document: null,
  workspaceTitle: 'PEMP kavramsal tasarim calismasi',
  projectMemory: {
    'preference.analysis_depth': 'Ciktilar karar verilebilir ve urun seviyesinde derin olmalidir.',
    'preference.document_format': 'Kavramsal tasarim dokumanlari Word sablonuna yakin uretilmelidir.',
    'decision.visible_surface': 'Yeni uretimde gorunur yuzey BA Analiz ve Review olmalidir.',
  },
  sourceReport: pempSourceReport,
  trace: productMindTrace,
});
const productMindRuntimeInstruction = buildCopilotRuntimeInstruction(productMindRuntime);
const productMindRuntimeReview = buildCopilotRuntimeReviewMarkdown(productMindRuntime);
assert(productMindTrace.problemFrame.businessProblem.length > 20, 'Copilot trace should carry a real ProblemFrame snapshot');
assert(productMindTrace.evidenceLedger.length >= 3, 'Copilot trace should carry an evidence ledger');
assert(productMindTrace.evidenceLedger.some(item => item.status === 'DOGRULANDI' || item.status === 'CIKARIM'), 'Evidence ledger should separate verified/inferred claims');
assert(productMindTrace.taskPlan.some(item => item.agent === 'quality'), 'Copilot task plan should include quality agent work');
assert(productMindTrace.toolExecutionPlan.some(item => item.tool === 'project_memory' && item.availability === 'available_now'), 'Copilot trace should mark project memory as available');
assert(productMindTrace.artifactContract.mustInclude[0] === productMindTurnDecision.artifactProfile.requiredSections[0], 'Artifact contract must inherit required sections from AiTurnDecision profile');
assert(!productMindTrace.artifactContract.mustInclude.some(item => /ProblemFrame/i.test(item)), 'Internal ProblemFrame must not become a forced user-document section');
assert(productMindTrace.traceabilityMatrix.length >= 3, 'Copilot trace should include traceability rows');
assert(productMindTrace.validationLoop.length >= 4, 'Copilot trace should include a validation and repair loop');
assertIncludes(productMindInstruction, 'Evidence ledger', 'Copilot instruction should expose evidence ledger');
assertIncludes(productMindInstruction, 'Gap decision matrix', 'Copilot instruction should expose gap decisions');
assertIncludes(productMindInstruction, 'Agent task plan', 'Copilot instruction should expose agent task plan');
assertIncludes(productMindInstruction, 'Tool execution plan', 'Copilot instruction should expose tool execution plan');
assertIncludes(productMindInstruction, 'Traceability matrix', 'Copilot instruction should expose traceability matrix');
assertIncludes(productMindInstruction, 'Artifact contract', 'Copilot instruction should expose artifact contract');
assertIncludes(productMindReview, 'ProblemFrame Snapshot', 'Copilot review should expose ProblemFrame snapshot');
assertIncludes(productMindReview, 'Evidence Ledger', 'Copilot review should expose evidence ledger');
assertIncludes(productMindReview, 'Gap Decision Matrix', 'Copilot review should expose gap decision matrix');
assertIncludes(productMindReview, 'Agent Task Plan', 'Copilot review should expose agent task plan');
assertIncludes(productMindReview, 'Tool Execution Plan', 'Copilot review should expose tool execution plan');
assertIncludes(productMindReview, 'Traceability Matrix', 'Copilot review should expose traceability matrix');
assertIncludes(productMindReview, 'Artifact Contract', 'Copilot review should expose artifact contract');
assertIncludes(productMindReview, 'Validation Loop', 'Copilot review should expose validation loop');
assert(productMindRuntime.stateMachine.length >= 8, 'Runtime should expose a state-machine transition list');
assert(productMindRuntime.sourceDescriptors.some(item => item.type === 'user_message' && item.authority === 'user_provided'), 'Runtime should model the user request as a source descriptor');
assert(productMindRuntime.sourceDescriptors.some(item => item.type === 'source_intelligence' && item.authority === 'system_inferred'), 'Runtime should model parsed source intelligence separately');
assert(productMindRuntime.sourceDescriptors.some(item => item.type === 'project_memory'), 'Runtime should model persistent project memory as a source descriptor');
assert(productMindRuntime.workingMemory.confirmedDecisions.some(item => /Visible sections|gorunur yuzey|BA Analiz/i.test(item)), 'Runtime working memory should carry visible surface decisions');
assert(productMindRuntime.workingMemory.userPreferences.some(item => /urun seviyesinde derin|Word sablon/i.test(item)), 'Runtime working memory should carry user preferences');
assert(productMindRuntime.toolSteps.some(item => item.tool === 'source_reader' && item.executionStatus === 'executed'), 'Runtime should mark source_reader as executed because source intelligence was built');
assert(productMindRuntime.toolSteps.every(item => !['browser_test', 'build', 'typecheck'].includes(item.tool) || item.executionStatus !== 'executed'), 'Runtime must not mark browser/build/typecheck as executed without evidence');
assert(productMindRuntime.approvalPoints.length >= 1, 'Runtime should always expose approval policy, even when approval is not required');
assert(productMindRuntime.completionEvidence.some(item => item.id === 'DONE-TOOL-HONESTY'), 'Runtime should expose tool honesty completion evidence');
assertIncludes(productMindRuntimeInstruction, 'COPILOT RUNTIME STATE MACHINE', 'Runtime instruction should expose the product contract');
assertIncludes(productMindRuntimeInstruction, 'Tool execution truth', 'Runtime instruction should expose tool execution truth');
assertIncludes(productMindRuntimeInstruction, 'Human approval points', 'Runtime instruction should expose human approval points');
assertIncludes(productMindRuntimeInstruction, 'Completion evidence', 'Runtime instruction should expose completion evidence');
assertIncludes(productMindRuntimeReview, 'Cognitive State Machine', 'Runtime review should expose state machine');
assertIncludes(productMindRuntimeReview, 'Source Descriptors', 'Runtime review should expose source descriptors');
assertIncludes(productMindRuntimeReview, 'Working Memory', 'Runtime review should expose working memory');
assertIncludes(productMindRuntimeReview, 'Tool Execution Truth', 'Runtime review should expose tool truth');
assertIncludes(productMindRuntimeReview, 'Human Approval Points', 'Runtime review should expose approval points');
assertIncludes(productMindRuntimeReview, 'Completion Evidence', 'Runtime review should expose completion evidence');
const userFacingDocument = {
  businessAnalysis: {
    content: '# KAVRAMSAL TASARIM RAPORU\n\nREQ-01 PEMP surec gereksinimi.',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: productMindReview,
    status: 'DRAFT' as const,
    flags: [],
  },
};
assert(!(userFacingDocument.review.content || '').includes('Copilot Runtime State Machine'), 'Runtime telemetry must not pollute the user review document');
assert(!(userFacingDocument.review.flags || []).includes('COPILOT_RUNTIME_STATE'), 'Runtime telemetry must not add internal flags to the user document');
const runtimeAttachedGate = evaluateDocumentQualityGate(userFacingDocument as any);
assert(!runtimeAttachedGate.missingSections.some(item => /Runtime state machine/i.test(item)), 'Quality gate must not require internal runtime telemetry');

const memoryUpdates = extractProjectMemoryUpdates({
  userMessage: 'Bundan sonra dokumanlar derin, karar verilebilir ve Word kavramsal tasarim formatina uygun olsun. Kural olarak kaynakli iddialari varsayimdan ayir. Runtime state machine, tool honesty ve insan onayi izlenmeli.',
  aiMessage: 'Copilot Cognitive Decision Trace ve Evidence Ledger Review tarafinda gorunur.',
  document: {
    businessAnalysis: {
      content: '# KAVRAMSAL TASARIM RAPORU',
      status: 'DRAFT' as const,
      flags: [],
    },
    review: {
      content: 'Copilot Cognitive Decision Trace\n\nEvidence Ledger\n\nCopilot Runtime State Machine\n\nTool Execution Truth\n\nCompletion Evidence',
      status: 'DRAFT' as const,
      flags: [],
    },
  },
});
assert(!!memoryUpdates['preference.analysis_depth'], 'Project memory should extract depth preference');
assert(!!memoryUpdates['preference.document_format'], 'Project memory should extract document format preference');
assert(!!memoryUpdates['preference.evidence_policy'], 'Project memory should extract evidence policy preference');
assert(!!memoryUpdates['preference.runtime_policy'], 'Project memory should extract runtime/tool honesty preference');
assert(!memoryUpdates['system.copilot_trace_enabled'], 'User document content must not enable internal cognitive trace capabilities');
assert(!memoryUpdates['system.runtime_state_enabled'], 'User document content must not enable internal runtime capabilities');
const mergedMemory = mergeProjectMemory({ 'decision.old': 'Eski karar' }, memoryUpdates);
assert(mergedMemory['decision.old'] === 'Eski karar', 'Project memory merge should preserve existing decisions');
assert(!!mergedMemory['preference.analysis_depth'], 'Project memory merge should include new updates');
const memoryContext = buildProjectMemoryContext(mergedMemory);
assertIncludes(memoryContext, 'USER-SOURCED PROJECT MEMORY - ZORUNLU', 'Project memory context should be prompt-ready');
assertIncludes(memoryContext, 'preference.analysis_depth', 'Project memory context should include extracted preference');

const sparseMindSource = analyzeSourceIntelligence({
  sourceText: sapCrmAiSalesBotRequest,
  workspaceTitle: '',
});
const sparseMindBehavior = buildBehaviorDecision({
  userMessage: sapCrmAiSalesBotRequest,
  document: null,
  discoveryReadiness: 15,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.6,
    reason: 'sparse_product_mind_trace',
  }),
});
const sparseMindFrame = buildBaCognitiveFrame({
  userMessage: sapCrmAiSalesBotRequest,
  recentConversation: '',
  document: null,
  sourceReport: sparseMindSource,
  behaviorDecision: sparseMindBehavior,
});
const sparseMindTrace = buildCopilotCognitiveTrace({
  userMessage: sapCrmAiSalesBotRequest,
  messages: [],
  knowledgeBase: [],
  document: null,
  hasSelectedText: false,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.6,
    reason: 'sparse_product_mind_trace',
  }),
  behaviorDecision: sparseMindBehavior,
  sourceReport: sparseMindSource,
  cognitiveFrame: sparseMindFrame,
  discoverySignals: {
    mustGenerateNow: false,
    greetingOnly: false,
    newStandaloneRequest: true,
    reason: 'test_sparse_product_mind',
  },
});
assert(sparseMindTrace.gapDecisions.length >= 1, 'Sparse copilot trace should carry gap decisions');
assert(sparseMindTrace.gapDecisions.some(item => item.decision === 'ask_now' || item.decision === 'block_until_source'), 'Sparse high-impact gaps should ask or block instead of silently drafting');

const executionRequest = 'jetwork ai kod gelistir repo incele tarayici test et build typecheck calistir';
const executionSource = analyzeSourceIntelligence({
  sourceText: executionRequest,
  workspaceTitle: '',
});
const executionBehavior = buildBehaviorDecision({
  userMessage: executionRequest,
  document: null,
  discoveryReadiness: 70,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.75,
    documentImpact: 'updates_document',
    reason: 'execution_runtime_honesty',
  }),
});
const executionFrame = buildBaCognitiveFrame({
  userMessage: executionRequest,
  recentConversation: '',
  document: null,
  sourceReport: executionSource,
  behaviorDecision: executionBehavior,
});
const executionTrace = buildCopilotCognitiveTrace({
  userMessage: executionRequest,
  messages: [],
  knowledgeBase: [],
  document: null,
  hasSelectedText: false,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.75,
    documentImpact: 'updates_document',
    reason: 'execution_runtime_honesty',
  }),
  behaviorDecision: executionBehavior,
  sourceReport: executionSource,
  cognitiveFrame: executionFrame,
  discoverySignals: {
    mustGenerateNow: true,
    greetingOnly: false,
    newStandaloneRequest: false,
    reason: 'test_execution_runtime_honesty',
  },
});
const executionRuntime = buildCopilotRuntimeSnapshot({
  userMessage: executionRequest,
  messages: [],
  knowledgeBase: [],
  document: null,
  workspaceTitle: '',
  projectMemory: {},
  sourceReport: executionSource,
  trace: executionTrace,
});
assert(executionRuntime.toolSteps.some(item => item.tool === 'browser_test' && item.executionStatus === 'requires_external_host'), 'Runtime should not claim browser_test execution without browser evidence');
assert(executionRuntime.toolSteps.some(item => item.tool === 'build' && item.executionStatus === 'requires_external_host'), 'Runtime should not claim build execution without build evidence');
assert(executionRuntime.toolSteps.some(item => item.tool === 'typecheck' && item.executionStatus === 'requires_external_host'), 'Runtime should not claim typecheck execution without typecheck evidence');
assert(executionRuntime.completionStatus === 'awaiting_user' || executionRuntime.completionStatus === 'awaiting_external_tool', 'Runtime should stay incomplete when external execution evidence is pending');
const executionRuntimeWithEvidence = buildCopilotRuntimeSnapshot({
  userMessage: executionRequest,
  messages: [],
  knowledgeBase: [],
  document: null,
  workspaceTitle: '',
  projectMemory: {},
  sourceReport: executionSource,
  trace: executionTrace,
  executionEvidence: [
    { tool: 'browser_test', status: 'succeeded', summary: 'Browser smoke scenario passed.', evidenceRef: 'test://browser-smoke', confidence: 95 },
    { tool: 'build', status: 'succeeded', summary: 'Production build passed.', evidenceRef: 'test://vite-build', confidence: 95 },
    { tool: 'typecheck', status: 'succeeded', summary: 'TypeScript typecheck passed.', evidenceRef: 'test://tsc', confidence: 95 },
  ],
});
assert(executionRuntimeWithEvidence.toolSteps.some(item => item.tool === 'browser_test' && item.executionStatus === 'executed' && /Browser smoke/.test(item.evidence)), 'Runtime should accept browser execution evidence');
assert(executionRuntimeWithEvidence.toolSteps.some(item => item.tool === 'build' && item.executionStatus === 'executed' && /Production build/.test(item.evidence)), 'Runtime should accept build execution evidence');
assert(executionRuntimeWithEvidence.toolSteps.some(item => item.tool === 'typecheck' && item.executionStatus === 'executed' && /typecheck passed/i.test(item.evidence)), 'Runtime should accept typecheck execution evidence');

const genericOpsRequest = `
Proje Adi: Abonelik Iptal ve Iade Operasyon Platformu
Roller: Musteri temsilcisi, Operasyon lideri, Finans onaycisi
Sistemler: Musteri Portali, ERP, Odeme Servisi
Entegrasyonlar: ERP API, Odeme Servisi webhook, E-posta bildirim servisi
Surec 1 - Iptal talebinin alinmasi
Surec 2 - Hak edis ve iade kontrolu
Surec 3 - Finans onayi ve odeme
Ekranlar: Talep kayit formu, iade durum ekrani, operasyon is listesi
KPI: Iade tamamlanma suresi, hata orani, manuel is yuku azalimi
Riskler: ERP mutabakat gecikmesi, odeme servisinde tekrarli hata
Acik Konular: Iade limitleri ve onay esikleri netlesmeli
`;
const genericOpsReport = analyzeSourceIntelligence({
  sourceText: genericOpsRequest,
  workspaceTitle: '',
});
assert(genericOpsReport.inferredProjectName === 'Abonelik Iptal ve Iade Operasyon Platformu', 'Generic source intelligence should infer explicit project names');
assert(genericOpsReport.processes.length === 3, 'Generic source intelligence should extract numbered process lines');
assert(genericOpsReport.processes.some(item => /Iptal talebinin alinmasi/i.test(item.title)), 'Generic process extraction should preserve process titles');
assert(genericOpsReport.roles.some(item => /Operasyon lideri/i.test(item)), 'Generic source intelligence should extract labeled roles');
assert(genericOpsReport.systems.some(item => /Odeme Servisi/i.test(item)), 'Generic source intelligence should extract labeled systems');
assert(genericOpsReport.integrations.some(item => /webhook/i.test(item)), 'Generic source intelligence should extract labeled integrations');
assert(genericOpsReport.uiNeeds.some(item => /iade durum ekrani/i.test(item)), 'Generic source intelligence should extract labeled UI needs');
assert(genericOpsReport.kpis.some(item => /hata orani/i.test(item)), 'Generic source intelligence should extract labeled KPIs');
assert(genericOpsReport.risks.some(item => /mutabakat/i.test(item)), 'Generic source intelligence should extract labeled risks');
assert(genericOpsReport.openTopics.some(item => /limitleri/i.test(item)), 'Generic source intelligence should extract labeled open topics');

const genericOpsBadDocument = postProcessDocumentData({
  businessAnalysis: {
    content: '# KAVRAMSAL TASARIM RAPORU\n\nGenel operasyon platformu icin taslak.',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: 'Genel review.',
    status: 'DRAFT' as const,
    flags: [],
  },
}, null, {
  sourceText: genericOpsRequest,
  workspaceTitle: '',
}).document;
assertIncludes(genericOpsBadDocument.businessAnalysis?.content || '', 'Genel operasyon platformu icin taslak', 'Post processor should preserve weak model output for transparent review');
assert(!/Kaynak Uyum Onarimi|Finans onayi ve odeme|Odeme Servisi webhook|Izlenebilirlik ve Testlenebilirlik Matrisi|Analysis Coverage Matrix/i.test(genericOpsBadDocument.businessAnalysis?.content || ''), 'Post processor must not inject source, traceability, or coverage prose');
assert(!/Source Fidelity Guard|Traceability Guard|Analysis Coverage Guard/i.test(genericOpsBadDocument.review?.content || ''), 'Post processor must not inject quality guards into Review');
assert((genericOpsBadDocument.businessAnalysis?.flags || []).length === 0, 'Post processor must not mutate BA flags');
assert((genericOpsBadDocument.review?.flags || []).length === 0, 'Post processor must not mutate Review flags');
assert(!(genericOpsBadDocument.suggestions || []).some(item => /Kaynak talep izlerini|Traceability matrisini|Coverage matrisini/i.test(item)), 'Post processor must not inject quick actions');
assert((genericOpsBadDocument.qualityAssessment?.findings || []).some(item => item.category === 'source'), 'Source fidelity gaps should be structured findings');
assert((genericOpsBadDocument.qualityAssessment?.findings || []).some(item => item.category === 'coverage'), 'Coverage gaps should be structured findings');
const genericOpsGateAfterAssessment = evaluateDocumentQualityGate(genericOpsBadDocument);
assert(genericOpsGateAfterAssessment.missingSections.length > 0, 'Assessment must preserve quality gaps instead of repairing them');

const pempDocument = ensureConceptualTemplateStructure({
  businessAnalysis: {
    content: pempRequest,
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: 'PEMP kaynak talebi icin review taslagi.',
    status: 'DRAFT' as const,
    flags: [],
  },
});
const pempContent = pempDocument.businessAnalysis.content;
assertIncludes(pempContent, 'MUSTERI COZUMLERI PROJE YONETIM SISTEMI', 'PEMP fallback should preserve the source project tracking context');
assert(!/SUREC MODELI|SÜREÇ MODELİ/i.test(pempContent), 'Read-only template boundary must not synthesize PEMP process blocks');
assert(/Bakim Islemleri/i.test(pempContent), 'Read-only template boundary must preserve source process text');
/*
assertIncludes(pempContent, 'Müşteri Çözümleri Proje Yönetim Sistemi', 'PEMP fallback should infer the real project tracking context');
assert(/S(Ü|Ãœ)RE(Ç|Ã‡) MODEL(İ|Ä°)\s*-\s*9\s+"Bakım İşlemleri"/i.test(pempContent), 'PEMP fallback should create the ninth maintenance process block');
*/
assertIncludes(pempContent, 'Genel Dashboard', 'PEMP fallback should preserve dashboard expectations');
assertIncludes(pempContent, 'zorunlu evrak', 'PEMP fallback should include mandatory document rules');
assert(!/Dijital S[oö]zle[sş]me Projesi|Dijital [İI]mza|OTP/i.test(pempContent), 'PEMP fallback should not be contaminated by digital contract or OTP content');

const contaminatedPempGate = evaluateDocumentQualityGate({
  businessAnalysis: {
    content: '# KAVRAMSAL TASARIM RAPORU\n\nPEMP-1157 GES proje takip dokumani.\n\n## 1. SUREC MODELI - 1 "Dijital Imza / OTP Dogrulama"\nYuzeysel taslak.',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: 'Risk: genel geçer taslak.',
    status: 'DRAFT' as const,
    flags: [],
  },
}, {
  sourceProcessTitles: pempSourceReport.processes.map(process => process.title),
});
assert(!contaminatedPempGate.canPublishToPanel, 'Quality gate should block contaminated PEMP documents');
assert(contaminatedPempGate.missingSections.some(item => /Kaynak surec kapsami/i.test(item)), 'Quality gate should explain missing source process coverage without domain hardcodes');

const generated = normalizeBaClassifierOutput(
  { userMessage: assumptionFollowUp, document: null, model: 'test-model' },
  buildClassification('generate_integration_analysis', { reason: 'sap_iys_test' }),
);

assert(generated.shouldRunBaAgentLoop, 'Assumption follow-up should run BA agent loop');
assert(!generated.requiresClarification, 'Assumption follow-up should not ask more questions');
assert(generated.requiresResearch, 'Assumption follow-up should preserve research need');
assert(generated.researchType === 'web', 'Assumption follow-up should route research to web grounding');
assert(/behavior:force_draft_with_assumptions/.test(generated.reason), 'Assumption follow-up should mark behavior draft mode');

const shortSapDraft = normalizeBaClassifierOutput(
  { userMessage: shortSapIysRequest, document: null, model: 'test-model' },
  buildClassification('generate_integration_analysis', {
    confidence: 0.4,
    requiresClarification: true,
    reason: 'short_domain_request',
  }),
);

assert(!shortSapDraft.shouldRunBaAgentLoop, 'Short SAP IYS request should not draft immediately when only the domain is clear');
assert(shortSapDraft.requiresClarification, 'Short SAP IYS request should ask contextual questions before drafting');
assert(shortSapDraft.documentImpact === 'none', 'Short SAP IYS request should avoid document update before discovery or force-draft signal');
assert(/behavior:domain_discovery_before_draft:sap_crm_iys/.test(shortSapDraft.reason), 'Short SAP IYS request should mark domain discovery mode');
assert((shortSapDraft.clarificationQuestions || []).some((item) => /IYS izin kapsami/i.test(item)), 'Short SAP IYS request should use IYS-specific questions');

const genericQuestion = normalizeBaClassifierOutput(
  { userMessage: 'proje dokumani', document: null, model: 'test-model' },
  buildClassification('generate_business_analysis', {
    confidence: 0.4,
    requiresClarification: true,
    reason: 'generic_short_request',
  }),
);

assert(genericQuestion.requiresClarification, 'Very generic short request may still ask critical BA questions');
assert((genericQuestion.clarificationQuestions || []).length <= 3, 'Generic BA questions should be capped at three');
assert((genericQuestion.clarificationQuestions || []).some((item) => /Ana is problemi/i.test(item)), 'Generic BA questions should follow BA mindset');

const parsed = parseClassifierQuestion('IYS izin kapsami nedir?\nSecenekler: Tum kanallar | Sadece SMS | Varsayimla ilerle', 0);
assert(parsed.options.length === 3, 'Classifier question parser should preserve options');
assert(parsed.options[0] === 'Tum kanallar', 'Classifier question parser should trim option labels');

const crmAiSalesDraft = normalizeBaClassifierOutput(
  { userMessage: sapCrmAiSalesBotRequest, document: null, model: 'test-model' },
  buildClassification('generate_business_analysis', {
    confidence: 0.4,
    requiresClarification: true,
    reason: 'short_crm_ai_sales_request',
  }),
);

assert(!crmAiSalesDraft.shouldRunBaAgentLoop, 'Short SAP CRM AI sales bot request should not draft immediately when only the domain is clear');
assert(crmAiSalesDraft.requiresClarification, 'Short SAP CRM AI sales bot request should ask contextual questions before drafting');
assert(crmAiSalesDraft.documentImpact === 'none', 'Short SAP CRM AI sales bot request should avoid document update before discovery or force-draft signal');
assert(/behavior:domain_discovery_before_draft:sap_crm_ai_sales_bot/.test(crmAiSalesDraft.reason), 'CRM AI sales bot request should mark its behavior domain discovery mode');
assert((crmAiSalesDraft.clarificationQuestions || []).some((item) => /AI satis botu hangi kanallarda/i.test(item)), 'CRM AI sales bot request should use CRM AI sales questions');

console.log('Deep BA Assistant verification passed.');
