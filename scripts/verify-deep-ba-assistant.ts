import {
  buildDeepBaActInstructions,
  buildDeepBaResearchPlan,
  parseClassifierQuestion,
  requiresExternalKnowledge,
  shouldUseDeepBaAssistant,
} from '../src/modules/deep-ba-assistant';
import { buildClassification, normalizeBaClassifierOutput } from '../src/services/ai/intentClassifier';
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
const assumptionFollowUp = 'sap crm iys entegrasyonu\nVarsayımlarla ilerle. Eksik bilgileri tahmini olarak doldur.';

assert(shouldUseDeepBaAssistant(sapIysRequest), 'SAP CRM + IYS request should activate deep BA mode');
assert(requiresExternalKnowledge(sapIysRequest), 'SAP CRM + IYS request should require external knowledge');

const researchPlan = buildDeepBaResearchPlan(sapIysRequest);
assert(researchPlan.enabled, 'Deep BA research plan should be enabled');
assert(researchPlan.searchQueries.some((query) => /3 is gunu/i.test(query)), 'Research queries should cover the 3 business day rule');
assert(researchPlan.searchQueries.some((query) => /recipient/i.test(query)), 'Research queries should cover IYS API fields');
assert(researchPlan.documentGapsToCheck.some((gap) => /BR\/FR\/NFR\/INT/i.test(gap)), 'Document gaps should include coded requirements');

const actInstructions = buildDeepBaActInstructions(sapIysRequest);
assertIncludes(actInstructions, 'document.businessAnalysis', 'Deep instructions should target the visible BA document');
assertIncludes(actInstructions, 'document.review', 'Deep instructions should target the visible review document');
assertIncludes(actInstructions, '3 is gunu', 'Deep instructions should carry SAP IYS regulation focus');
assertIncludes(actInstructions, 'MESAJ', 'Deep instructions should include IYS channel concepts');
assertIncludes(actInstructions, 'EPOSTA', 'Deep instructions should include e-mail consent channel');
assertIncludes(actInstructions, 'ARAMA', 'Deep instructions should include call consent channel');
assertIncludes(actInstructions, 'recipient', 'Deep instructions should include API recipient concept');

assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'KAVRAMSAL TASARIM RAPORU', 'Corporate prompt should require the report title');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'PROJE KİMLİK KARTI', 'Corporate prompt should require project identity card');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'Doküman Tarihçesi', 'Corporate prompt should require document history');
assertIncludes(CONCEPTUAL_TEMPLATE_PROMPT, 'SÜREÇ MODELİ', 'Corporate prompt should require process model blocks');
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
assert(isConceptualTemplateCompliant(templatedContent), 'Post processor fallback should produce a compliant conceptual template');
assertIncludes(templatedContent, 'KAVRAMSAL TASARIM RAPORU', 'Fallback should start from conceptual report title');
assertIncludes(templatedContent, 'PROJE KİMLİK KARTI', 'Fallback should include project identity card');
assertIncludes(templatedContent, 'Doküman Tarihçesi', 'Fallback should include document history');
assertIncludes(templatedContent, 'SÜREÇ TASARIMI', 'Fallback should include process design');
assertIncludes(templatedContent, 'EK A', 'Fallback should include appendix A');
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
assert(/deep_ba_assistant_v2/.test(generated.reason), 'Assumption follow-up should mark deep BA mode');

const question = normalizeBaClassifierOutput(
  { userMessage: 'sap crm iys entegrasyonu', document: null, model: 'test-model' },
  buildClassification('generate_integration_analysis', {
    confidence: 0.4,
    requiresClarification: true,
    reason: 'short_domain_request',
  }),
);

assert(question.requiresClarification, 'Short SAP IYS request should ask contextual questions first');
assert((question.clarificationQuestions || []).some((item) => /İYS izin kapsamı/.test(item)), 'Contextual questions should include IYS channel scope');
assert((question.clarificationQuestions || []).some((item) => /Seçenekler:/.test(item)), 'Classifier questions should carry quick options');

const parsed = parseClassifierQuestion('İYS izin kapsamı nedir?\nSeçenekler: Tüm kanallar | Sadece SMS | Varsayımla ilerle', 0);
assert(parsed.options.length === 3, 'Classifier question parser should preserve options');
assert(parsed.options[0] === 'Tüm kanallar', 'Classifier question parser should trim option labels');

console.log('Deep BA Assistant verification passed.');
