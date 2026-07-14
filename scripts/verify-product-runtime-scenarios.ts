import { buildClassification } from '../src/services/ai/intentClassifier';
import { buildBehaviorDecision } from '../src/services/ai/behaviorDecision';
import { buildBaCognitiveFrame } from '../src/services/ai/baCognitiveFrame';
import { buildAiTurnDecision } from '../src/services/ai/aiTurnDecision';
import { buildCopilotCognitiveTrace } from '../src/services/ai/copilotCognitiveArchitecture';
import { attachCopilotRuntimeToDocument, buildCopilotRuntimeSnapshot } from '../src/services/ai/copilotRuntimeState';
import { analyzeSourceIntelligence } from '../src/services/sourceIntelligence';
import { postProcessDocumentData } from '../src/services/documentPostProcessor';
import { evaluateDocumentQualityGate } from '../src/services/documentQualityGate';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function buildRuntimeFor(userMessage: string, options: {
  readiness?: number;
  mustGenerateNow?: boolean;
  documentImpact?: 'none' | 'updates_document';
} = {}) {
  const sourceReport = analyzeSourceIntelligence({
    sourceText: userMessage,
    workspaceTitle: '',
  });
  const classification = buildClassification('generate_business_analysis', {
    confidence: 0.72,
    documentImpact: options.documentImpact || 'updates_document',
    reason: 'product_runtime_scenario',
  });
  const behaviorDecision = buildBehaviorDecision({
    userMessage,
    document: null,
    discoveryReadiness: options.readiness ?? 40,
    classification,
  });
  const cognitiveFrame = buildBaCognitiveFrame({
    userMessage,
    recentConversation: '',
    document: null,
    sourceReport,
    behaviorDecision,
  });
  const discoverySignals = {
    mustGenerateNow: options.mustGenerateNow ?? false,
    greetingOnly: false,
    newStandaloneRequest: true,
    reason: 'product_runtime_scenario',
  };
  const turnDecision = buildAiTurnDecision({
    userMessage,
    document: null,
    classification,
    behaviorDecision,
    cognitiveFrame,
    sourceReport,
    discoverySignals,
  });
  const trace = buildCopilotCognitiveTrace({
    userMessage,
    messages: [],
    knowledgeBase: [],
    document: null,
    hasSelectedText: false,
    classification,
    behaviorDecision,
    sourceReport,
    cognitiveFrame,
    turnDecision,
    discoverySignals,
  });
  const runtime = buildCopilotRuntimeSnapshot({
    userMessage,
    messages: [],
    knowledgeBase: [],
    document: null,
    workspaceTitle: '',
    projectMemory: {
      'preference.analysis_depth': 'Karar verilebilir urun seviyesi analiz.',
      'preference.runtime_policy': 'Tool honesty ve completion evidence izlenmeli.',
    },
    sourceReport,
    trace,
  });
  return { sourceReport, classification, behaviorDecision, cognitiveFrame, turnDecision, trace, runtime };
}

const sparseProject = buildRuntimeFor('sap crm ai satis botu projesi', {
  readiness: 15,
  documentImpact: 'updates_document',
});
assert(sparseProject.behaviorDecision.shouldAskQuestions, 'Sparse project idea should ask targeted discovery questions');
assert(sparseProject.runtime.completionStatus === 'awaiting_user', 'Sparse project idea should wait for user decisions');
assert(sparseProject.runtime.approvalPoints.some(point => point.status === 'required' || point.status === 'requested'), 'Sparse project should expose approval/decision points');

const sensitiveSourceProject = buildRuntimeFor('sap crm musteri verisi ile KKB Findeks API entegrasyonu kavramsal dokuman hazirla varsayimlarla ilerle', {
  readiness: 80,
  mustGenerateNow: true,
  documentImpact: 'updates_document',
});
assert(sensitiveSourceProject.turnDecision.sourcePolicy.officialSourceRequired, 'KKB/Findeks/API runtime should require official-source policy');
assert(!sensitiveSourceProject.turnDecision.sourcePolicy.canClaimVerified, 'Low-evidence KKB/Findeks runtime should block broad DOGRULANDI claims');
assert(sensitiveSourceProject.trace.evidenceLedger.some(row => row.source === 'ai_turn_decision.source_policy'), 'Evidence ledger should include AI turn source policy row');
assert(!sensitiveSourceProject.trace.evidenceLedger.some(row => row.status === 'DOGRULANDI' && /kkb|findeks|api/i.test(row.claim)), 'Evidence ledger should not keep KKB/Findeks/API claims as DOGRULANDI without official evidence');

const detailedRequest = `
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

const processed = postProcessDocumentData({
  businessAnalysis: {
    content: '# KAVRAMSAL TASARIM RAPORU\n\nIlk taslak.',
    status: 'DRAFT',
    flags: [],
  },
  review: {
    content: 'Review taslagi.',
    status: 'DRAFT',
    flags: [],
  },
}, null, {
  sourceText: detailedRequest,
  workspaceTitle: '',
}).document;

assert(/Word Template Conformance Guard/i.test(processed.review?.content || ''), 'Processed document should carry Word template guard');
assert(/Izlenebilirlik ve Testlenebilirlik Matrisi/i.test(processed.businessAnalysis?.content || ''), 'Processed document should carry traceability matrix');
assert(/Analysis Coverage Matrix/i.test(processed.businessAnalysis?.content || ''), 'Processed document should carry analysis coverage matrix');
assert((processed.suggestions || []).some(item => /Tamamlanacak alanları kapat|Şablon uyumunu tamamla/i.test(item)), 'Processed document should expose product quick actions');

const detailedRuntime = buildRuntimeFor(detailedRequest, {
  readiness: 90,
  mustGenerateNow: true,
});
const runtimeAttachedProcessed = attachCopilotRuntimeToDocument(processed, detailedRuntime.runtime) || processed;
const gate = evaluateDocumentQualityGate(runtimeAttachedProcessed);
assert(!gate.missingSections.some(item => /Runtime state machine/i.test(item)), 'Runtime-attached document should satisfy runtime state machine quality gate');

const executionScenario = buildRuntimeFor('repo incele kod gelistir build typecheck tarayici test et', {
  readiness: 80,
  mustGenerateNow: true,
});
assert(executionScenario.runtime.toolSteps.some(step => step.tool === 'build' && step.executionStatus === 'requires_external_host'), 'Build should require execution evidence');
assert(executionScenario.runtime.toolSteps.some(step => step.tool === 'browser_test' && step.executionStatus === 'requires_external_host'), 'Browser test should require execution evidence');

const executionWithEvidence = buildCopilotRuntimeSnapshot({
  userMessage: 'repo incele kod gelistir build typecheck tarayici test et',
  messages: [],
  knowledgeBase: [],
  document: null,
  workspaceTitle: '',
  projectMemory: {},
  sourceReport: executionScenario.sourceReport,
  trace: executionScenario.trace,
  executionEvidence: [
    { tool: 'build', status: 'succeeded', summary: 'Vite production build completed.', evidenceRef: 'local://vite-build', confidence: 95 },
    { tool: 'typecheck', status: 'succeeded', summary: 'TypeScript typecheck completed.', evidenceRef: 'local://tsc', confidence: 95 },
    { tool: 'browser_test', status: 'succeeded', summary: 'Browser smoke test completed.', evidenceRef: 'local://browser', confidence: 90 },
  ],
});
assert(executionWithEvidence.toolSteps.some(step => step.tool === 'build' && step.executionStatus === 'executed'), 'Build evidence should mark build as executed');
assert(executionWithEvidence.toolSteps.some(step => step.tool === 'typecheck' && step.executionStatus === 'executed'), 'Typecheck evidence should mark typecheck as executed');
assert(executionWithEvidence.toolSteps.some(step => step.tool === 'browser_test' && step.executionStatus === 'executed'), 'Browser evidence should mark browser_test as executed');

console.log('Product runtime scenarios passed.');
