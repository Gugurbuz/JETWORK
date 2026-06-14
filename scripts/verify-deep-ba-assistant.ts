import {
  buildDeepBaActInstructions,
  buildDeepBaResearchPlan,
  buildSourceVerificationPolicy,
  parseClassifierQuestion,
  requiresExternalKnowledge,
  shouldUseDeepBaAssistant,
} from '../src/modules/deep-ba-assistant';
import { buildClassification, normalizeBaClassifierOutput } from '../src/services/ai/intentClassifier';
import {
  applyBehaviorDecisionToClassification,
  buildBehaviorDecision,
  buildDomainQuestions,
} from '../src/services/ai/behaviorDecision';
import {
  CONCEPTUAL_TEMPLATE_PROMPT,
  conceptualTemplateCoverage,
  ensureConceptualTemplateStructure,
  isConceptualTemplateCompliant,
} from '../src/services/conceptualTemplate';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertIncludes(value: string, needle: string, message: string): void {
  assert(value.includes(needle), `${message}: expected "${needle}"`);
}

const sapIysRequest = 'sap crm iys entegrasyonu ba analiz kavramsal tasarim dokumani';
const shortSapIysRequest = 'sap crm iys entegrasyonu';
const sapCrmAiSalesBotRequest = 'sap crm ai satis botu projesi';
const assumptionFollowUp = 'sap crm iys entegrasyonu\nVarsayÄ±mlarla ilerle. Eksik bilgileri tahmini olarak doldur.';

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
assert(researchPlan.documentGapsToCheck.some((gap) => /BR\/FR\/NFR\/INT/i.test(gap)), 'Document gaps should include coded requirements');
assert(researchPlan.documentGapsToCheck.some((gap) => /dogrulama matrisi/i.test(gap)), 'Document gaps should include source verification matrix');

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

const actInstructions = buildDeepBaActInstructions(sapIysRequest);
assertIncludes(actInstructions, 'document.businessAnalysis', 'Deep instructions should target the visible BA document');
assertIncludes(actInstructions, 'document.review', 'Deep instructions should target the visible review document');
assertIncludes(actInstructions, '3 is gunu', 'Deep instructions should carry SAP IYS regulation focus');
assertIncludes(actInstructions, 'MESAJ', 'Deep instructions should include IYS channel concepts');
assertIncludes(actInstructions, 'EPOSTA', 'Deep instructions should include e-mail consent channel');
assertIncludes(actInstructions, 'ARAMA', 'Deep instructions should include call consent channel');
assertIncludes(actInstructions, 'recipient', 'Deep instructions should include API recipient concept');
assertIncludes(actInstructions, 'Kaynak ve Dogrulama Matrisi', 'Deep instructions should require source verification matrix');
assertIncludes(actInstructions, 'DOGRULANDI', 'Deep instructions should separate verified claims');
assertIncludes(actInstructions, 'VARSAYIM', 'Deep instructions should separate assumptions');
assertIncludes(actInstructions, 'ACIK KONU', 'Deep instructions should separate open topics');
const crmAiSalesActInstructions = buildDeepBaActInstructions(sapCrmAiSalesBotRequest);
assertIncludes(crmAiSalesActInstructions, 'lead yakalama', 'CRM AI sales instructions should include lead capture');
assertIncludes(crmAiSalesActInstructions, 'opportunity', 'CRM AI sales instructions should include opportunity handling');
assertIncludes(crmAiSalesActInstructions, 'temsilciye devir', 'CRM AI sales instructions should include human handoff');
assertIncludes(crmAiSalesActInstructions, 'AI davranis kurallarini', 'CRM AI sales instructions should include AI behavior rules');

const sapDomainQuestions = buildDomainQuestions('sap_crm_iys');
assert(sapDomainQuestions.length >= 4, 'SAP IYS behavior profile should expose at least 4 domain questions');
assert(sapDomainQuestions.some((item) => /marka/i.test(item)), 'SAP IYS domain questions should ask about brand code structure');
assert(sapDomainQuestions.some((item) => /Initial load/i.test(item)), 'SAP IYS domain questions should ask about initial load and delta scope');
const crmAiSalesDomainQuestions = buildDomainQuestions('sap_crm_ai_sales_bot');
assert(crmAiSalesDomainQuestions.length >= 4, 'SAP CRM AI sales bot behavior profile should expose at least 4 domain questions');
assert(crmAiSalesDomainQuestions.some((item) => /kanal/i.test(item)), 'CRM AI sales bot questions should ask about channels');
assert(crmAiSalesDomainQuestions.some((item) => /Lead \+ Opportunity/i.test(item)), 'CRM AI sales bot questions should ask about CRM sales objects');

const shortBehavior = buildBehaviorDecision({
  userMessage: shortSapIysRequest,
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_integration_analysis', {
    confidence: 0.65,
    reason: 'short_sap_iys',
  }),
});
assert(shortBehavior.mode === 'ask_clarifying_questions', 'Short SAP IYS request should enter discovery question mode');
assert(shortBehavior.domain === 'sap_crm_iys', 'Short SAP IYS request should detect sap_crm_iys domain');
assert(shortBehavior.requiredTemplate === 'corporate_conceptual_design', 'Short SAP IYS request should still bind to corporate template');
assert(shortBehavior.clarificationQuestions.some((item) => /IYS izin kapsami|Ä°YS izin kapsamÄ±/i.test(item)), 'Behavior questions should be domain-specific');

const crmAiSalesBehavior = buildBehaviorDecision({
  userMessage: sapCrmAiSalesBotRequest,
  document: null,
  discoveryReadiness: 20,
  classification: buildClassification('generate_business_analysis', {
    confidence: 0.65,
    reason: 'short_crm_ai_sales_bot',
  }),
});
assert(crmAiSalesBehavior.mode === 'ask_clarifying_questions', 'Short SAP CRM AI sales bot request should enter discovery question mode');
assert(crmAiSalesBehavior.domain === 'sap_crm_ai_sales_bot', 'Short SAP CRM AI sales bot request should detect sap_crm_ai_sales_bot domain');
assert(crmAiSalesBehavior.clarificationQuestions.some((item) => /AI satis botu/i.test(item)), 'CRM AI sales bot behavior questions should be domain-specific');

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

assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'KAVRAMSAL TASARIM RAPORU', 'Corporate prompt should require the report title');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'PROJE KÄ°MLÄ°K KARTI', 'Corporate prompt should require project identity card');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'DokÃ¼man TarihÃ§esi', 'Corporate prompt should require document history');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'SÃœREÃ‡ MODELÄ°', 'Corporate prompt should require process model blocks');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'en az 3 adet', 'Corporate prompt should require automatic process multiplication for integrations');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'Ãœst DÃ¼zey MÃ¼ÅŸteri GeliÅŸtirmesi', 'Corporate prompt should require development tables');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'EK A', 'Corporate prompt should require appendix A');

const legacyBaDraft = {
  businessAnalysis: {
    content: '# BA Analiz Raporu\n\n## AmaÃ§ ve Ä°ÅŸ DeÄŸeri\nSAP CRM Ä°YS entegrasyonu iÃ§in kÄ±sa taslak.\n\n## Kapsam\nÄ°zin aktarÄ±mÄ± ve mutabakat.',
    status: 'DRAFT' as const,
    flags: [],
  },
  review: {
    content: 'Riskler ve aÃ§Ä±k sorular daha sonra netleÅŸtirilecek.',
    status: 'DRAFT' as const,
    flags: [],
  },
};

assert(!isConceptualTemplateCompliant(legacyBaDraft.businessAnalysis.content), 'Legacy BA draft should not pass corporate conceptual template');
const templatedDocument = ensureConceptualTemplateStructure(legacyBaDraft);
const templatedContent = templatedDocument.businessAnalysis.content;
assert(isConceptualTemplateCompliant(templatedContent), 'Post processor fallback should produce a compliant conceptual template');
assertIncludes(templatedContent, 'KAVRAMSAL TASARIM RAPORU', 'Fallback should start from conceptual report title');
assertIncludes(templatedContent, 'PROJE KÄ°MLÄ°K KARTI', 'Fallback should include project identity card');
assertIncludes(templatedContent, 'DokÃ¼man TarihÃ§esi', 'Fallback should include document history');
assertIncludes(templatedContent, 'Kontrol EDEN VE ONAYLAYAN', 'Fallback should include approval table');
assertIncludes(templatedContent, 'SÃœREÃ‡ TASARIMI', 'Fallback should include process design');
assertIncludes(templatedContent, 'Ãœst DÃ¼zey MÃ¼ÅŸteri GeliÅŸtirmesi', 'Fallback should include development table blocks');
assertIncludes(templatedContent, 'Ä°LGÄ°LÄ° / REFERANS DOKÃœMANLAR', 'Fallback should include reference documents table');
assertIncludes(templatedContent, 'EK A', 'Fallback should include appendix A');
const processModelCount = (templatedContent.match(/SÃœREÃ‡ MODELÄ° - \d+/g) || []).length;
assert(processModelCount >= 3, 'SAP IYS fallback should create at least 3 process model blocks');
assert((templatedDocument.businessAnalysis.flags || []).includes('CONCEPTUAL_TEMPLATE_APPLIED'), 'Fallback should mark conceptual template application');
const coverage = conceptualTemplateCoverage(templatedContent);
assert(coverage.passed >= coverage.total - 2, 'Fallback template should cover almost all required headings');

const generated = normalizeBaClassifierOutput(
  { userMessage: assumptionFollowUp, document: null, model: 'test-model' },
  buildClassification('generate_integration_analysis', { reason: 'sap_iys_test' }),
);

assert(generated.shouldRunBaAgentLoop, 'Assumption follow-up should run BA agent loop');
assert(!generated.requiresClarification, 'Assumption follow-up should not ask more questions');
assert(generated.requiresResearch, 'Assumption follow-up should preserve research need');
assert(generated.researchType === 'web', 'Assumption follow-up should route research to web grounding');
assert(/behavior:force_draft_with_assumptions/.test(generated.reason), 'Assumption follow-up should mark behavior draft mode');

const question = normalizeBaClassifierOutput(
  { userMessage: shortSapIysRequest, document: null, model: 'test-model' },
  buildClassification('generate_integration_analysis', {
    confidence: 0.4,
    requiresClarification: true,
    reason: 'short_domain_request',
  }),
);

assert(question.requiresClarification, 'Short SAP IYS request should ask contextual questions first');
assert((question.clarificationQuestions || []).some((item) => /IYS izin kapsami|Ä°YS izin kapsamÄ±/.test(item)), 'Contextual questions should include IYS channel scope');
assert((question.clarificationQuestions || []).some((item) => /Secenekler:|SeÃ§enekler:/.test(item)), 'Classifier questions should carry quick options');
assert(/behavior:short_domain_discovery/.test(question.reason), 'Short SAP IYS request should mark behavior discovery mode');

const parsed = parseClassifierQuestion('IYS izin kapsami nedir?\nSecenekler: Tum kanallar | Sadece SMS | Varsayimla ilerle', 0);
assert(parsed.options.length === 3, 'Classifier question parser should preserve options');
assert(parsed.options[0] === 'Tum kanallar', 'Classifier question parser should trim option labels');

const crmAiSalesQuestion = normalizeBaClassifierOutput(
  { userMessage: sapCrmAiSalesBotRequest, document: null, model: 'test-model' },
  buildClassification('generate_business_analysis', {
    confidence: 0.4,
    requiresClarification: true,
    reason: 'short_crm_ai_sales_request',
  }),
);

assert(crmAiSalesQuestion.requiresClarification, 'Short SAP CRM AI sales bot request should ask contextual questions first');
assert((crmAiSalesQuestion.clarificationQuestions || []).some((item) => /AI satis botu hangi kanallarda/i.test(item)), 'CRM AI sales bot questions should include channel scope');
assert((crmAiSalesQuestion.clarificationQuestions || []).some((item) => /Lead \+ Opportunity/i.test(item)), 'CRM AI sales bot questions should include CRM sales objects');
assert(/sap_crm_ai_sales_bot/.test(crmAiSalesQuestion.reason), 'CRM AI sales bot request should mark its behavior domain');

console.log('Deep BA Assistant verification passed.');
