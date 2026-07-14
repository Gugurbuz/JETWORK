import type { DocumentData } from '../src/types';
import { evaluateDocumentQualityGate } from '../src/services/documentQualityGate';
import { postProcessDocumentData } from '../src/services/documentPostProcessor';
import { analyzeSourceIntelligence } from '../src/services/sourceIntelligence';
import {
  conceptualTemplateCoverage,
  ensureConceptualTemplateStructure,
} from '../src/services/conceptualTemplate';
import {
  getPrimaryDomainProfile,
  processTitlesFromProfile,
} from '../src/services/domainProfiles';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function stripHtml(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|tr|div|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalize(value = ''): string {
  return stripHtml(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[Ä±Ä°]/g, 'i')
    .replace(/[ÅŸÅ]/g, 's')
    .replace(/[ÄŸÄ]/g, 'g')
    .replace(/[Ã¼Ãœ]/g, 'u')
    .replace(/[Ã¶Ã–]/g, 'o')
    .replace(/[Ã§Ã‡]/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function allContent(document: DocumentData): string {
  return [
    document.businessAnalysis?.content || '',
    document.review?.content || '',
  ].join('\n\n');
}

function assertIncludes(value: string, expected: string, message: string): void {
  assert(
    normalize(value).includes(normalize(expected)),
    `${message}: expected "${expected}"`,
  );
}

function assertNotMatches(value: string, pattern: RegExp, message: string): void {
  assert(!pattern.test(normalize(value)), message);
}

function processDocument(sourceText: string, incomingBusinessAnalysis = 'Kisa ve genel taslak.'): DocumentData {
  return postProcessDocumentData({
    businessAnalysis: {
      content: incomingBusinessAnalysis,
      status: 'DRAFT',
      flags: [],
    },
    review: {
      content: 'Review taslagi.',
      status: 'DRAFT',
      flags: [],
    },
  }, null, {
    sourceText,
    workspaceTitle: '',
  }).document;
}

function assertDocumentCarriesGenericOpsSource(document: DocumentData): void {
  const content = allContent(document);
  [
    'Abonelik Iptal ve Iade Operasyon Platformu',
    'Iptal talebinin alinmasi',
    'Hak edis ve iade kontrolu',
    'Finans onayi ve odeme',
    'Musteri temsilcisi',
    'Operasyon lideri',
    'Finans onaycisi',
    'Musteri Portali',
    'ERP',
    'Odeme Servisi webhook',
    'Talep kayit formu',
    'iade durum ekrani',
    'operasyon is listesi',
    'Iade tamamlanma suresi',
    'hata orani',
    'manuel is yuku azalimi',
  ].forEach((expected) => assertIncludes(content, expected, 'Generic operations source signal should be present'));
}

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
assert(!['sap_crm_iys', 'sap_crm_ai_sales_bot', 'field_mobile_app', 'digital_contract', 'project_tracking_pemp'].includes(getPrimaryDomainProfile(genericOpsRequest)?.id || ''), 'Generic operations request should not be forced into an unrelated fixed domain profile');
assert(genericOpsReport.inferredProjectName === 'Abonelik Iptal ve Iade Operasyon Platformu', 'Source intelligence should infer the explicit project name');
assert(genericOpsReport.processes.length === 3, 'Source intelligence should extract the three source process lines');
assert(genericOpsReport.roles.length >= 3, 'Source intelligence should extract labeled roles');
assert(genericOpsReport.systems.length >= 3, 'Source intelligence should extract labeled systems');
assert(genericOpsReport.integrations.some(item => /webhook/i.test(item)), 'Source intelligence should extract webhook integration detail');
assert(genericOpsReport.uiNeeds.some(item => /iade durum/i.test(item)), 'Source intelligence should extract UI needs');
assert(genericOpsReport.kpis.some(item => /hata orani/i.test(item)), 'Source intelligence should extract KPI details');

const genericOpsDocument = processDocument(genericOpsRequest);
assertDocumentCarriesGenericOpsSource(genericOpsDocument);
assertIncludes(genericOpsDocument.businessAnalysis.content, 'KAVRAMSAL TASARIM RAPORU', 'Processed document should use the conceptual design title');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'PROJE KIMLIK KARTI', 'Processed document should include the identity card');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'SUREC TASARIMI', 'Processed document should include process design');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'SUREC MODELI', 'Processed document should include process model blocks');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'Izlenebilirlik ve Testlenebilirlik Matrisi', 'Processed document should include traceability matrix');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'REQ-01', 'Traceability should include REQ ids');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'BR-01-01', 'Traceability should include BR ids');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'AC-01-01', 'Traceability should include AC ids');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'TC-01-01', 'Traceability should include TC ids');
assertIncludes(genericOpsDocument.businessAnalysis.content, 'Analysis Coverage Matrix', 'Processed document should include coverage matrix');
assertIncludes(genericOpsDocument.review?.content || '', 'Source Fidelity Guard', 'Review should include source fidelity guard');
assertIncludes(genericOpsDocument.review?.content || '', 'Word Template Conformance Guard', 'Review should include Word template guard');
assertIncludes(genericOpsDocument.review?.content || '', 'Kaynak Talep', 'Review should include source intelligence');
assert((genericOpsDocument.suggestions || []).some(item => /Word format|Kaynak|Coverage|Traceability|Review/i.test(item)), 'Document should expose content quality quick actions');
assertNotMatches(genericOpsDocument.businessAnalysis.content, /dijital imza|otp|dijital sozlesme|d2d saha|iys izin|sap crmden/, 'Generic operations document should not be contaminated by unrelated fixed domains');

const genericOpsTemplateCoverage = conceptualTemplateCoverage(genericOpsDocument.businessAnalysis.content);
assert(genericOpsTemplateCoverage.passed >= genericOpsTemplateCoverage.total - 3, 'Processed document should be close to the Word conceptual template');
const genericOpsGate = evaluateDocumentQualityGate(genericOpsDocument);
assert(genericOpsGate.score >= 60, `Quality gate score should be product-testable after repairs, got ${genericOpsGate.score}`);
assert(genericOpsDocument.score !== undefined && genericOpsDocument.score >= 60, 'Document score should be present and explainable');
assert(!!genericOpsDocument.scoreExplanation, 'Document should carry score explanation');

const crmAiSalesBotProfileRequest = 'sap crm ai satis botu projesi';
assert(getPrimaryDomainProfile(crmAiSalesBotProfileRequest)?.id === 'sap_crm_ai_sales_bot', 'SAP CRM AI sales bot should be detected by the central domain profile');
const crmAiSalesBotProcesses = processTitlesFromProfile(crmAiSalesBotProfileRequest);
assert(crmAiSalesBotProcesses.length >= 3, 'SAP CRM AI sales bot profile should provide process candidates');
assert(crmAiSalesBotProcesses.some(item => /lead/i.test(item)), 'SAP CRM AI sales bot process profile should include lead qualification');
assert(!crmAiSalesBotProcesses.some(item => /iys|teminat|bakim/i.test(normalize(item))), 'SAP CRM AI sales bot profile should not leak IYS or PEMP process titles');

const kkbFindeksRequest = 'sap crm musteri verisi ile KKB Findeks API entegrasyonu kavramsal dokuman hazirla';
assert(getPrimaryDomainProfile(kkbFindeksRequest)?.id === 'integration_project', 'KKB/Findeks integration should stay in the integration profile, not a CRM AI sales bot profile');
assert(getPrimaryDomainProfile(kkbFindeksRequest)?.id !== 'sap_crm_ai_sales_bot', 'KKB/Findeks integration must not be misclassified as SAP CRM AI sales bot');
assert(processTitlesFromProfile(kkbFindeksRequest).length === 0, 'KKB/Findeks integration should not inherit CRM AI sales bot process titles');

const mismatchedDocument = processDocument(
  genericOpsRequest,
  '# KAVRAMSAL TASARIM RAPORU\n\nSAP CRM IYS entegrasyonu icin genel taslak. IYS izin aktarimi ve SAP mutabakati anlatilir.',
);
assertDocumentCarriesGenericOpsSource(mismatchedDocument);
assertIncludes(mismatchedDocument.businessAnalysis.content, 'Kaynak Uyum Onarimi', 'Mismatched weak draft should be repaired against the real source');
assertIncludes(mismatchedDocument.review?.content || '', 'Source Fidelity Guard', 'Mismatched weak draft should keep a review guard');
assertNotMatches(mismatchedDocument.businessAnalysis.content, /iys izin aktarimi.*sap mutabakati.*ana kapsam/, 'Wrong incoming context should not dominate the repaired document');

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

const pempReport = analyzeSourceIntelligence({
  sourceText: pempRequest,
  workspaceTitle: '',
});
assert(pempReport.processes.length >= 9, `PEMP source intelligence should extract at least nine process models, got ${pempReport.processes.length}`);
const pempDocument = ensureConceptualTemplateStructure({
  businessAnalysis: {
    content: pempRequest,
    status: 'DRAFT',
    flags: [],
  },
  review: {
    content: 'PEMP review taslagi.',
    status: 'DRAFT',
    flags: [],
  },
});
const pempContent = allContent(pempDocument);
[
  'MUSTERI COZUMLERI PROJE YONETIM SISTEMI',
  'PEMP-1157',
  'Proje Kaydinin',
  'Teminat',
  'Satinalma',
  'Alt Yuklenici',
  'Musteri Islemleri',
  'Kurulum',
  'GES Kabul',
  'Faturalama',
  'Bakim Islemleri',
  'Genel Dashboard',
  'zorunlu evrak',
].forEach((expected) => assertIncludes(pempContent, expected, 'PEMP conceptual template should preserve source-specific detail'));
assertNotMatches(pempContent, /dijital imza|otp|dijital sozlesme|d2d saha|iys izin aktarimi/, 'PEMP document should not be contaminated by unrelated fixed domains');

const sparseIdea = 'sap crm ai satis botu projesi';
const sparseIdeaDocument = processDocument(sparseIdea);
const sparseIdeaContent = allContent(sparseIdeaDocument);
assertIncludes(sparseIdeaContent, 'sap crm ai satis botu', 'Sparse idea document should preserve the user phrase when forced through post-processing');
assertIncludes(sparseIdeaDocument.businessAnalysis.content, 'KAVRAMSAL TASARIM RAPORU', 'Sparse idea document should still keep the Word conceptual structure');
assertNotMatches(sparseIdeaContent, /iys izin aktarimi|d2d saha|dijital imza|otp|bakim islemleri|teminat mektubu/, 'Sparse idea should not inherit unrelated fixed project content');

console.log('Document content quality verification passed.');
