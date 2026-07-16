import type { DocumentData, KnowledgeItem, Message } from '../../types';
import type { SourceIntelligenceReport } from '../sourceIntelligence';
import type {
  CopilotCognitiveTrace,
  CopilotToolType,
  ToolExecutionPlanItem,
} from './copilotCognitiveArchitecture';
import type { ProjectMemory } from './projectMemoryEngine';

export type CognitiveRuntimeState =
  | 'receive_request'
  | 'understand_intent'
  | 'load_memory'
  | 'inspect_sources'
  | 'frame_problem'
  | 'identify_gaps'
  | 'resolve_action'
  | 'ask_questions'
  | 'create_plan'
  | 'select_agents'
  | 'select_tools'
  | 'execute_tools'
  | 'generate_artifact'
  | 'validate_artifact'
  | 'repair_artifact'
  | 'request_approval'
  | 'complete'
  | 'failed';

export type SourceDescriptorType =
  | 'user_message'
  | 'conversation_history'
  | 'current_document'
  | 'knowledge_base'
  | 'project_memory'
  | 'workspace_title'
  | 'source_intelligence'
  | 'official_reference_required';

export type SourceAuthority =
  | 'user_provided'
  | 'workspace_private'
  | 'workspace_artifact'
  | 'system_inferred'
  | 'official_required'
  | 'external_verified';

export type SourceFreshness =
  | 'current_turn'
  | 'recent_history'
  | 'existing_workspace'
  | 'unknown';

export type SourceCompleteness =
  | 'empty'
  | 'sparse'
  | 'partial'
  | 'structured'
  | 'rich';

export type SourceProjectRelation =
  | 'primary_request'
  | 'supporting_context'
  | 'existing_artifact'
  | 'memory_context'
  | 'potentially_conflicting'
  | 'validation_requirement';

export interface SourceDescriptor {
  sourceId: string;
  type: SourceDescriptorType;
  title: string;
  authority: SourceAuthority;
  relevance: number;
  freshness: SourceFreshness;
  completeness: SourceCompleteness;
  confidentiality: 'workspace_private' | 'public_or_official' | 'unknown';
  projectRelation: SourceProjectRelation;
  extractedSignals: string[];
  reliabilityRule: string;
}

export interface RuntimeWorkingMemory {
  projectSummary: string;
  confirmedFacts: string[];
  confirmedDecisions: string[];
  assumptions: string[];
  rejectedAssumptions: string[];
  openQuestions: string[];
  stakeholders: string[];
  scopeItems: string[];
  businessRules: string[];
  artifacts: string[];
  userPreferences: string[];
  unresolvedConflicts: string[];
  currentTask: string;
}

export interface RuntimeTransition {
  from: CognitiveRuntimeState;
  to: CognitiveRuntimeState;
  guard: string;
  operation: string;
  evidence: string;
  failureAction: string;
  status: 'completed' | 'planned' | 'blocked' | 'skipped';
}

export interface RuntimeToolStep {
  tool: CopilotToolType;
  availability: ToolExecutionPlanItem['availability'];
  executionStatus:
    | 'executed'
    | 'available_not_needed'
    | 'planned_not_executed'
    | 'requires_external_host'
    | 'requires_human_approval'
    | 'blocked';
  purpose: string;
  evidence: string;
  honestyRule: string;
  nextAction: string;
}

export interface RuntimeExecutionEvidence {
  tool: CopilotToolType;
  status: 'succeeded' | 'failed' | 'skipped';
  summary: string;
  evidenceRef?: string;
  confidence: number;
}

export interface RuntimeApprovalPoint {
  id: string;
  topic: string;
  trigger: string;
  requiredBefore: CognitiveRuntimeState;
  owner: 'user' | 'business_owner' | 'technical_owner' | 'legal_owner' | 'product_owner';
  status: 'not_required' | 'required' | 'requested' | 'approved' | 'blocked';
  reason: string;
}

export interface RuntimeCompletionEvidence {
  id: string;
  evidenceType: 'state' | 'artifact' | 'source' | 'tool' | 'approval' | 'validation' | 'handoff';
  statement: string;
  status: 'met' | 'partial' | 'pending' | 'failed';
  confidence: number;
  nextAction: string;
}

export interface CopilotRuntimeSnapshot {
  currentState: CognitiveRuntimeState;
  finalAction: CopilotCognitiveTrace['finalDecision']['action'];
  stateMachine: RuntimeTransition[];
  sourceDescriptors: SourceDescriptor[];
  workingMemory: RuntimeWorkingMemory;
  toolSteps: RuntimeToolStep[];
  approvalPoints: RuntimeApprovalPoint[];
  completionEvidence: RuntimeCompletionEvidence[];
  operatingPrinciples: string[];
  failureModes: string[];
  completionStatus: 'complete' | 'partial' | 'awaiting_user' | 'awaiting_external_tool' | 'failed';
}

export interface BuildCopilotRuntimeSnapshotInput {
  userMessage: string;
  messages?: Message[];
  knowledgeBase?: KnowledgeItem[];
  document: DocumentData | null;
  workspaceTitle?: string;
  projectMemory?: ProjectMemory;
  executionEvidence?: RuntimeExecutionEvidence[];
  sourceReport: SourceIntelligenceReport;
  trace: CopilotCognitiveTrace;
}

const RUNTIME_REVIEW_START = '<!-- COPILOT_RUNTIME_STATE_START -->';
const RUNTIME_REVIEW_END = '<!-- COPILOT_RUNTIME_STATE_END -->';

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}

function textLength(value = ''): number {
  return value.replace(/\s+/g, ' ').trim().length;
}

function documentText(document: DocumentData | null | undefined): string {
  if (!document) return '';
  return [
    document.businessAnalysis?.content,
    document.review?.content,
    document.code?.content,
    document.test?.content,
    document.bpmn?.content,
  ].filter(Boolean).join('\n\n');
}

function completenessFromSignals(signalCount: number, length: number): SourceCompleteness {
  if (length <= 0 && signalCount <= 0) return 'empty';
  if (signalCount >= 8 || length > 5000) return 'rich';
  if (signalCount >= 4 || length > 1800) return 'structured';
  if (signalCount >= 2 || length > 600) return 'partial';
  return 'sparse';
}

function descriptor(
  sourceId: string,
  type: SourceDescriptorType,
  title: string,
  authority: SourceAuthority,
  relevance: number,
  freshness: SourceFreshness,
  completeness: SourceCompleteness,
  confidentiality: SourceDescriptor['confidentiality'],
  projectRelation: SourceProjectRelation,
  extractedSignals: string[],
  reliabilityRule: string,
): SourceDescriptor {
  return {
    sourceId,
    type,
    title,
    authority,
    relevance: clamp(relevance),
    freshness,
    completeness,
    confidentiality,
    projectRelation,
    extractedSignals: uniq(extractedSignals).slice(0, 12),
    reliabilityRule,
  };
}

function sourceReportSignals(report: SourceIntelligenceReport): string[] {
  return uniq([
    report.inferredProjectName ? `project:${report.inferredProjectName}` : '',
    ...report.domainHints.map(item => `domain:${item}`),
    ...report.processes.map(item => `process:${item.title}`),
    ...report.roles.map(item => `role:${item}`),
    ...report.systems.map(item => `system:${item}`),
    ...report.integrations.map(item => `integration:${item}`),
    ...report.uiNeeds.map(item => `ui:${item}`),
    ...report.dashboardNeeds.map(item => `dashboard:${item}`),
    ...report.kpis.map(item => `kpi:${item}`),
    ...report.openTopics.map(item => `open:${item}`),
  ]);
}

export function buildRuntimeSourceDescriptors(input: BuildCopilotRuntimeSnapshotInput): SourceDescriptor[] {
  const descriptors: SourceDescriptor[] = [];
  const messageLength = textLength(input.userMessage);
  descriptors.push(descriptor(
    'SRC-USER-REQUEST',
    'user_message',
    'Current user request',
    'user_provided',
    100,
    'current_turn',
    completenessFromSignals(input.sourceReport.processes.length + input.sourceReport.systems.length, messageLength),
    'workspace_private',
    'primary_request',
    uniq([
      input.sourceReport.inferredProjectName ? `project:${input.sourceReport.inferredProjectName}` : '',
      ...input.sourceReport.domainHints.map(item => `domain:${item}`),
      ...input.sourceReport.processes.slice(0, 6).map(item => `process:${item.title}`),
    ]),
    'Kullanici mesaji ana kaynak kabul edilir; eksik veya belirsiz kisimlar varsayim/acik konu olarak ayrilir.',
  ));

  const recentMessages = input.messages || [];
  if (recentMessages.length) {
    const recentText = recentMessages.slice(-12).map(message => message.text || '').join('\n');
    descriptors.push(descriptor(
      'SRC-CONVERSATION',
      'conversation_history',
      'Recent conversation history',
      'workspace_private',
      78,
      'recent_history',
      completenessFromSignals(recentMessages.length, textLength(recentText)),
      'workspace_private',
      'supporting_context',
      uniq(recentMessages.slice(-8).map(message => message.text || '').filter(Boolean)).slice(0, 8),
      'Sohbet gecmisi tercih, karar ve elestiri sinyali verir; yeni talep ile celisirse current user request onceliklidir.',
    ));
  }

  if (input.workspaceTitle) {
    descriptors.push(descriptor(
      'SRC-WORKSPACE-TITLE',
      'workspace_title',
      'Workspace title',
      'workspace_private',
      50,
      'existing_workspace',
      'sparse',
      'workspace_private',
      'supporting_context',
      [input.workspaceTitle],
      'Workspace basligi yardimci ipucudur; kullanici talebi veya ek dokumanla celisirse tek basina gerceklik kaynagi sayilmaz.',
    ));
  }

  const currentDocumentText = documentText(input.document);
  if (currentDocumentText) {
    descriptors.push(descriptor(
      'SRC-CURRENT-DOCUMENT',
      'current_document',
      'Current right-panel document',
      'workspace_artifact',
      82,
      'existing_workspace',
      completenessFromSignals(
        [
          /KAVRAMSAL TASARIM RAPORU/i.test(currentDocumentText) ? 'template' : '',
          /SUREC|SÜREÇ|SÃœREÃ‡/i.test(currentDocumentText) ? 'process' : '',
          /REQ-|BR-|FR-|NFR-|AC-|TC-/i.test(currentDocumentText) ? 'traceability' : '',
          /Evidence Ledger|Kaynak ve Dogrulama Matrisi/i.test(currentDocumentText) ? 'evidence' : '',
        ].filter(Boolean).length,
        textLength(currentDocumentText),
      ),
      'workspace_private',
      'existing_artifact',
      [
        input.document?.businessAnalysis?.content ? 'artifact:businessAnalysis' : '',
        input.document?.review?.content ? 'artifact:review' : '',
        input.document?.score != null ? `score:${input.document.score}` : '',
        input.document?.scoreExplanation ? `score_reason:${input.document.scoreExplanation}` : '',
      ],
      'Mevcut dokuman revizyon baglami verir; yeni talep baska proje ise karistirilmaz.',
    ));
  }

  const memoryEntries = Object.entries(input.projectMemory || {});
  if (memoryEntries.length) {
    descriptors.push(descriptor(
      'SRC-PROJECT-MEMORY',
      'project_memory',
      'Persistent project working memory',
      'workspace_private',
      85,
      'existing_workspace',
      completenessFromSignals(memoryEntries.length, memoryEntries.map(([, value]) => value).join(' ').length),
      'workspace_private',
      'memory_context',
      memoryEntries.slice(-12).map(([key, value]) => `${key}:${value}`),
      'Hafiza kullanici tercihleri ve kalici kararlar icindir; kullanicinin son talebiyle celisirse son talep onceliklidir.',
    ));
  }

  if ((input.knowledgeBase || []).length) {
    const items = input.knowledgeBase || [];
    descriptors.push(descriptor(
      'SRC-KNOWLEDGE-BASE',
      'knowledge_base',
      'Retrieved workspace knowledge',
      'workspace_private',
      72,
      'existing_workspace',
      completenessFromSignals(items.length, items.map(item => item.content).join(' ').length),
      'workspace_private',
      'supporting_context',
      items.slice(0, 10).map(item => `${item.id}:${item.keywords.join(',') || item.content.slice(0, 80)}`),
      'Knowledge base yardimci baglamdir; iddia kaynagi olarak kullanilacaksa dokumanda kaynak/varsayim ayrimi korunur.',
    ));
  }

  const reportSignals = sourceReportSignals(input.sourceReport);
  descriptors.push(descriptor(
    'SRC-SOURCE-INTELLIGENCE',
    'source_intelligence',
    'Parsed source intelligence report',
    'system_inferred',
    input.sourceReport.confidence,
    'current_turn',
    completenessFromSignals(reportSignals.length, reportSignals.join(' ').length),
    'workspace_private',
    reportSignals.length ? 'supporting_context' : 'validation_requirement',
    reportSignals,
    'Source intelligence bir yorumlayici katmandir; kesin bilgi degil, kaynak izlerinden cikarimdir.',
  ));

  const requiresOfficial = input.trace.evidenceLedger.some(entry => (
    entry.source === 'official_source_required'
    || entry.status === 'ACIK_KONU' && /mevzuat|api|sap|iys|resmi/i.test(entry.claim)
  ));
  if (requiresOfficial) {
    descriptors.push(descriptor(
      'SRC-OFFICIAL-REFERENCE-REQUIRED',
      'official_reference_required',
      'Official/legal/API reference still required',
      'official_required',
      95,
      'unknown',
      'empty',
      'public_or_official',
      'validation_requirement',
      ['official source required', 'do not mark legal/API/SAP claims as verified without source'],
      'Resmi kaynak incelenmeden mevzuat/API/SAP iddialari DOGRULANDI olamaz.',
    ));
  }

  return descriptors;
}

function memoryValuesByPrefix(projectMemory: ProjectMemory | undefined, prefix: string): string[] {
  return Object.entries(projectMemory || {})
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => value)
    .filter(Boolean);
}

function sectionArtifacts(document: DocumentData | null | undefined): string[] {
  if (!document) return [];
  return uniq([
    document.businessAnalysis?.content ? 'businessAnalysis: mevcut BA/kavramsal tasarim icerigi' : '',
    document.review?.content ? 'review: kalite, risk, kaynak ve acik konu icerigi' : '',
    document.code?.content ? 'legacy code section: yeni uretimde ana yuzey degil' : '',
    document.test?.content ? 'legacy test section: yeni uretimde ana yuzey degil' : '',
    document.bpmn?.content ? 'legacy bpmn section: yeni uretimde ana yuzey degil' : '',
  ]);
}

export function buildRuntimeWorkingMemory(input: BuildCopilotRuntimeSnapshotInput): RuntimeWorkingMemory {
  const report = input.sourceReport;
  const trace = input.trace;
  const projectSummary = report.inferredProjectName
    ? `${report.inferredProjectName} icin ${trace.artifactContract.mode} modunda ${trace.finalDecision.action} aksiyonu.`
    : `${trace.artifactContract.mode} modunda ${trace.finalDecision.action} aksiyonu; proje adi acik konu.`;

  const confirmedFacts = uniq([
    ...trace.workingMemory.confirmedFacts,
    ...trace.evidenceLedger
      .filter(entry => entry.status === 'DOGRULANDI' || entry.status === 'CIKARIM')
      .map(entry => entry.claim),
  ]).slice(0, 18);

  const confirmedDecisions = uniq([
    ...memoryValuesByPrefix(input.projectMemory, 'decision.'),
    report.inferredProjectName ? `Project name inferred from source: ${report.inferredProjectName}` : '',
    `Artifact mode: ${trace.artifactContract.mode}`,
    `Visible sections: ${trace.artifactContract.visibleSections.join(', ')}`,
    `Final action: ${trace.finalDecision.action}`,
  ]).slice(0, 14);

  const assumptions = uniq([
    ...trace.workingMemory.assumptions,
    ...memoryValuesByPrefix(input.projectMemory, 'assumption.'),
    ...trace.gapDecisions
      .filter(gap => gap.decision === 'assume_and_mark' && gap.assumption)
      .map(gap => gap.assumption || ''),
  ]).slice(0, 18);

  return {
    projectSummary,
    confirmedFacts,
    confirmedDecisions,
    assumptions,
    rejectedAssumptions: uniq([
      ...report.mismatchWarnings,
      ...trace.evidenceLedger.filter(entry => entry.status === 'CELISKI').map(entry => entry.claim),
    ]).slice(0, 12),
    openQuestions: uniq([
      ...trace.workingMemory.openQuestions,
      ...memoryValuesByPrefix(input.projectMemory, 'open_question.'),
      ...trace.gapDecisions
        .filter(gap => gap.decision === 'ask_now' || gap.decision === 'block_until_source' || gap.decision === 'verify_with_source')
        .map(gap => gap.question || gap.topic),
    ]).slice(0, 18),
    stakeholders: uniq([
      ...report.roles,
      ...trace.problemFrame.stakeholders,
    ]).slice(0, 14),
    scopeItems: uniq([
      ...trace.problemFrame.inScope,
      ...report.processes.map(process => `process:${process.title}`),
      ...report.systems.map(system => `system:${system}`),
      ...report.integrations.map(integration => `integration:${integration}`),
    ]).slice(0, 18),
    businessRules: uniq([
      ...report.documentRules,
      ...trace.artifactContract.mustInclude.filter(item => /business rule|is kurali|BR|validasyon|kural/i.test(item)),
    ]).slice(0, 14),
    artifacts: sectionArtifacts(input.document),
    userPreferences: uniq([
      ...trace.workingMemory.userPreferences,
      ...memoryValuesByPrefix(input.projectMemory, 'preference.'),
    ]).slice(0, 14),
    unresolvedConflicts: uniq([
      ...trace.workingMemory.unresolvedConflicts,
      ...report.mismatchWarnings,
    ]).slice(0, 12),
    currentTask: trace.finalDecision.userExplanation,
  };
}

function toRuntimeState(value: string): CognitiveRuntimeState {
  const allowed: CognitiveRuntimeState[] = [
    'receive_request',
    'understand_intent',
    'load_memory',
    'inspect_sources',
    'frame_problem',
    'identify_gaps',
    'resolve_action',
    'ask_questions',
    'create_plan',
    'select_agents',
    'select_tools',
    'execute_tools',
    'generate_artifact',
    'validate_artifact',
    'repair_artifact',
    'request_approval',
    'complete',
    'failed',
  ];
  return allowed.includes(value as CognitiveRuntimeState) ? value as CognitiveRuntimeState : 'failed';
}

function stateOperation(to: CognitiveRuntimeState): string {
  const operations: Record<CognitiveRuntimeState, string> = {
    receive_request: 'Kullanici talebini ve secili dokuman baglamini al.',
    understand_intent: 'Niyet, artifact modu, domain ve dokuman etkisini siniflandir.',
    load_memory: 'Proje hafizasi, sohbet tercihleri ve mevcut dokuman sinyallerini yukle.',
    inspect_sources: 'Kaynak izlerini, sistemleri, rolleri, surecleri ve acik konulari ayikla.',
    frame_problem: 'ProblemFrame ve hedef sonuc modelini kur.',
    identify_gaps: 'Bilgi bosluklarini etki ve geri donus maliyetine gore siniflandir.',
    resolve_action: 'Soru sorma, varsayimla taslak, kaynakli taslak, revizyon veya onay kararini ver.',
    ask_questions: 'Sadece kritik ve sonucu degistiren sorulari sor.',
    create_plan: 'Agent, cikti ve kalite plani olustur.',
    select_agents: 'BA, teknik, research, quality gibi perspektifleri sec.',
    select_tools: 'Gerekli araclari ve yetki durumunu sec.',
    execute_tools: 'Mevcut runtime icinde kullanilabilen araclari calistir; digerlerini plan olarak isaretle.',
    generate_artifact: 'BA/Review gorunur yuzeyinde artifact uret veya revize et.',
    validate_artifact: 'Coverage, traceability, source fidelity ve kalite kapilarini kontrol et.',
    repair_artifact: 'Eksik matris, kaynak uyumu veya coverage onarimini uygula.',
    request_approval: 'Yuksek riskli karar veya dis sisteme yazma icin insan onayi iste.',
    complete: 'Kullaniciya ne yapildigini, kaliteyi ve kalan riski acikla.',
    failed: 'Runtime basarisiz oldu; guvenli hata ve toparlama mesaji uret.',
  };
  return operations[to];
}

function stateFailureAction(to: CognitiveRuntimeState): string {
  const failureActions: Record<CognitiveRuntimeState, string> = {
    receive_request: 'Talep bos ise kisa yeniden ifade iste.',
    understand_intent: 'Niyet guveni dusukse dokumani degistirmeden kisitli soru sor.',
    load_memory: 'Hafiza yoksa memory_context bos kabul edilir; uydurma karar eklenmez.',
    inspect_sources: 'Kaynak zayifsa resmi/dogrulanmis/varsayim ayrimi yap.',
    frame_problem: 'Problem net degilse cozum talebi ile ihtiyaci ayir ve kritik soru sor.',
    identify_gaps: 'Blocking gap varsa uretimi durdur veya kullanici onayi iste.',
    resolve_action: 'Karar celisirse en dusuk riskli aksiyon olan ask_questions veya suggest-only moduna gec.',
    ask_questions: 'Soru sayisini azalt; onerilen cevaplar ve dokumana etkisi ekle.',
    create_plan: 'Plan olusmazsa minimal BA/Review planina dus.',
    select_agents: 'Agent yoksa orchestrator + quality minimum seti kullan.',
    select_tools: 'Arac yoksa kaynak/dokuman icinde offline calis ve bunu belirt.',
    execute_tools: 'Calismayan araci calismis gibi yazma; planned_not_executed olarak kaydet.',
    generate_artifact: 'Artifact bos gelirse force-draft ve post-process repair uygula.',
    validate_artifact: 'Kalite kapisi dusukse NEEDS_REVISION ve hizli aksiyon ekle.',
    repair_artifact: 'Onarim eksikse Review tarafinda kalan eksigi acikca yaz.',
    request_approval: 'Onay yoksa dis yazma/deploy/geri donusu pahali kararlari uygulama.',
    complete: 'Tamamlanma kaniti yoksa partial status ve sonraki aksiyon ver.',
    failed: 'Kullanicidan toparlama icin tek bir net girdi iste.',
  };
  return failureActions[to];
}

export function buildRuntimeStateMachine(trace: CopilotCognitiveTrace): RuntimeTransition[] {
  const states = trace.statePath.map(toRuntimeState);
  if (states.length < 2) return [];

  const firstFutureIndex = states.findIndex(state => (
    state === 'ask_questions'
    || state === 'create_plan'
    || state === 'select_agents'
    || state === 'select_tools'
    || state === 'execute_tools'
    || state === 'generate_artifact'
    || state === 'validate_artifact'
    || state === 'repair_artifact'
    || state === 'request_approval'
    || state === 'complete'
  ));

  return states.slice(0, -1).map((from, index) => {
    const to = states[index + 1];
    const future = firstFutureIndex >= 0 && index + 1 >= firstFutureIndex;
    const blocked = trace.finalDecision.action === 'ask_blocking_questions'
      && !['ask_questions', 'complete'].includes(to)
      && future;
    return {
      from,
      to,
      guard: `finalAction=${trace.finalDecision.action}; confidence artifact=${trace.confidence.artifactConfidence}/100; validation=${trace.confidence.validationConfidence}/100`,
      operation: stateOperation(to),
      evidence: future
        ? `planned_by_trace:${trace.finalDecision.rationaleCodes.join('|')}`
        : `completed_by_orchestrator:${from}->${to}`,
      failureAction: stateFailureAction(to),
      status: blocked ? 'blocked' : future ? 'planned' : 'completed',
    };
  });
}

function buildRuntimeToolSteps(
  trace: CopilotCognitiveTrace,
  executionEvidence: RuntimeExecutionEvidence[] = [],
): RuntimeToolStep[] {
  return trace.toolExecutionPlan.map(tool => {
    const externalEvidence = executionEvidence.find(item => item.tool === tool.tool);
    const sourceReaderExecuted = tool.tool === 'source_reader';
    const memoryExecuted = tool.tool === 'project_memory' && trace.workingMemory.userPreferences.length > 0;
    const availableNotNeeded = tool.availability === 'available_now' && !sourceReaderExecuted && !memoryExecuted;
    const requiresApproval = tool.availability === 'human_approval_required';
    const requiresExternal = tool.availability === 'external_host_required';
    const plannedRouted = tool.availability === 'available_when_routed';
    const executionStatus: RuntimeToolStep['executionStatus'] = externalEvidence?.status === 'succeeded'
      ? 'executed'
      : externalEvidence?.status === 'failed'
        ? 'blocked'
        : externalEvidence?.status === 'skipped'
          ? 'planned_not_executed'
          : sourceReaderExecuted || memoryExecuted
      ? 'executed'
      : requiresApproval
        ? 'requires_human_approval'
        : requiresExternal
          ? 'requires_external_host'
          : plannedRouted
            ? 'planned_not_executed'
            : availableNotNeeded
              ? 'available_not_needed'
              : 'blocked';

    const evidence = externalEvidence
      ? `${externalEvidence.status}: ${externalEvidence.summary}${externalEvidence.evidenceRef ? ` (${externalEvidence.evidenceRef})` : ''}`
      : executionStatus === 'executed'
        ? tool.tool === 'source_reader'
          ? 'sourceReport and cognitiveFrame were produced in this turn.'
          : 'project memory signals were present in the trace.'
      : executionStatus === 'available_not_needed'
        ? 'Tool is available, but no runtime result was needed for this turn.'
        : executionStatus === 'planned_not_executed'
          ? 'Tool is only planned; no execution result is claimed.'
          : executionStatus === 'requires_human_approval'
            ? 'Human approval is required before execution.'
            : 'External developer/browser/build host is required; no execution result is claimed.';

    return {
      tool: tool.tool,
      availability: tool.availability,
      executionStatus,
      purpose: tool.purpose,
      evidence,
      honestyRule: tool.honestyRule,
      nextAction: externalEvidence?.status === 'failed'
        ? 'Fix the failed execution result before claiming completion.'
        : executionStatus === 'executed'
        ? 'Use result in evidence/source/decision trace.'
        : executionStatus === 'requires_human_approval'
          ? 'Ask or wait for explicit approval before action.'
          : executionStatus === 'requires_external_host'
            ? 'Run from Codex/dev environment and attach result before claiming completion.'
            : executionStatus === 'planned_not_executed'
              ? 'Route to the dedicated tool integration if the user requests it.'
              : 'No action needed.',
    };
  });
}

function buildApprovalPoints(trace: CopilotCognitiveTrace): RuntimeApprovalPoint[] {
  const approvals: RuntimeApprovalPoint[] = [];
  const criticalGaps = trace.gapDecisions.filter(gap => (
    gap.decision === 'ask_now'
    || gap.decision === 'block_until_source'
    || gap.impact === 'blocking'
    || (gap.impact === 'high' && gap.reversibility === 'expensive')
  ));

  criticalGaps.slice(0, 8).forEach((gap, index) => {
    approvals.push({
      id: `APR-GAP-${String(index + 1).padStart(2, '0')}`,
      topic: gap.topic,
      trigger: `impact=${gap.impact}; reversibility=${gap.reversibility}; decision=${gap.decision}`,
      requiredBefore: gap.decision === 'block_until_source' ? 'generate_artifact' : 'complete',
      owner: 'business_owner',
      status: trace.finalDecision.action === 'ask_blocking_questions' ? 'requested' : 'required',
      reason: gap.question || gap.reason,
    });
  });

  if (trace.toolExecutionPlan.some(tool => tool.tool === 'human_approval')) {
    approvals.push({
      id: 'APR-HUMAN-APPROVAL',
      topic: 'Human approval required by classification or preview policy',
      trigger: 'human_approval tool selected',
      requiredBefore: 'request_approval',
      owner: 'product_owner',
      status: 'required',
      reason: 'High-impact or preview-required change must not be applied silently.',
    });
  }

  if (trace.toolExecutionPlan.some(tool => ['code_editor', 'build', 'browser_test', 'document_export'].includes(tool.tool))) {
    approvals.push({
      id: 'APR-EXECUTION-EVIDENCE',
      topic: 'Execution evidence before claiming build/browser/export completion',
      trigger: 'tool plan contains execution-capable external tools',
      requiredBefore: 'complete',
      owner: 'technical_owner',
      status: 'required',
      reason: 'Runtime must distinguish planned work from actually executed verification.',
    });
  }

  if (trace.evidenceLedger.some(entry => entry.source === 'official_source_required')) {
    approvals.push({
      id: 'APR-OFFICIAL-SOURCE',
      topic: 'Official source validation',
      trigger: 'official_source_required evidence item',
      requiredBefore: 'validate_artifact',
      owner: 'legal_owner',
      status: 'required',
      reason: 'Legal/API/SAP/IYS claims require official or trusted source before DOGRULANDI label.',
    });
  }

  return approvals.length
    ? approvals
    : [{
      id: 'APR-NOT-REQUIRED',
      topic: 'No blocking approval detected',
      trigger: 'No critical gap, human approval, external write, or official-source blocker selected',
      requiredBefore: 'complete',
      owner: 'product_owner',
      status: 'not_required',
      reason: 'The current turn can proceed with visible evidence and assumptions.',
    }];
}

function buildCompletionEvidence(
  trace: CopilotCognitiveTrace,
  toolSteps: RuntimeToolStep[],
  approvalPoints: RuntimeApprovalPoint[],
  document: DocumentData | null,
): RuntimeCompletionEvidence[] {
  const doc = documentText(document);
  const hasArtifact = !!doc && /KAVRAMSAL TASARIM RAPORU|REQ-|BR-|FR-|NFR-|Evidence Ledger|Kaynak/i.test(doc);
  const hasPendingApprovals = approvalPoints.some(point => ['required', 'requested', 'blocked'].includes(point.status));
  const hasExternalPending = toolSteps.some(step => (
    step.executionStatus === 'requires_external_host'
    || step.executionStatus === 'requires_human_approval'
    || step.executionStatus === 'planned_not_executed'
  ));

  return [
    {
      id: 'DONE-STATE',
      evidenceType: 'state',
      statement: `Runtime state path resolved to ${trace.statePath.join(' -> ')}.`,
      status: trace.statePath.includes('failed') ? 'failed' : trace.finalDecision.action === 'ask_blocking_questions' ? 'partial' : 'met',
      confidence: trace.confidence.intentConfidence,
      nextAction: trace.finalDecision.action === 'ask_blocking_questions' ? 'Wait for critical answers or explicit assumption permission.' : 'Proceed according to final action.',
    },
    {
      id: 'DONE-SOURCE',
      evidenceType: 'source',
      statement: `Evidence ledger contains ${trace.evidenceLedger.length} tracked claims and ${trace.gapDecisions.length} gap decisions.`,
      status: trace.evidenceLedger.length && trace.traceabilityMatrix.length ? 'met' : 'partial',
      confidence: trace.confidence.sourceConfidence,
      nextAction: 'Keep DOGRULANDI / CIKARIM / VARSAYIM / ACIK_KONU labels visible.',
    },
    {
      id: 'DONE-TOOL-HONESTY',
      evidenceType: 'tool',
      statement: 'Tool plan separates executed, available, planned, approval-required and external-host work.',
      status: hasExternalPending ? 'partial' : 'met',
      confidence: 90,
      nextAction: hasExternalPending ? 'Run external/browser/build/export tools before claiming their results.' : 'No pending tool evidence.',
    },
    {
      id: 'DONE-ARTIFACT',
      evidenceType: 'artifact',
      statement: hasArtifact
        ? 'A visible document artifact is present for the turn.'
        : 'No generated document artifact is present yet.',
      status: hasArtifact ? 'met' : trace.finalDecision.action === 'ask_blocking_questions' ? 'pending' : 'partial',
      confidence: hasArtifact ? trace.confidence.artifactConfidence : 45,
      nextAction: hasArtifact ? 'Validate and repair via quality gates.' : 'Generate or revise businessAnalysis/review before claiming document completion.',
    },
    {
      id: 'DONE-VALIDATION',
      evidenceType: 'validation',
      statement: `Validation confidence is ${trace.confidence.validationConfidence}/100 and artifact contract has ${trace.artifactContract.qualityGates.length} gates.`,
      status: trace.confidence.validationConfidence >= 70 ? 'met' : 'partial',
      confidence: trace.confidence.validationConfidence,
      nextAction: trace.confidence.validationConfidence >= 70 ? 'Keep validation summary in Review.' : 'Add coverage, traceability, source fidelity and repair notes.',
    },
    {
      id: 'DONE-APPROVAL',
      evidenceType: 'approval',
      statement: hasPendingApprovals
        ? 'One or more approval/source/gap decisions remain pending.'
        : 'No blocking approval remains for this turn.',
      status: hasPendingApprovals ? 'pending' : 'met',
      confidence: hasPendingApprovals ? 65 : 95,
      nextAction: hasPendingApprovals ? 'Ask targeted question or mark as open topic before finalizing.' : 'No approval action needed.',
    },
    {
      id: 'DONE-HANDOFF',
      evidenceType: 'handoff',
      statement: 'User-facing response must explain what was done, why quality is high/low, and what remains.',
      status: 'partial',
      confidence: 80,
      nextAction: 'In final chat message, include concise done/verified/remaining summary.',
    },
  ];
}

function deriveCompletionStatus(
  trace: CopilotCognitiveTrace,
  toolSteps: RuntimeToolStep[],
  approvalPoints: RuntimeApprovalPoint[],
  completionEvidence: RuntimeCompletionEvidence[],
): CopilotRuntimeSnapshot['completionStatus'] {
  if (completionEvidence.some(item => item.status === 'failed')) return 'failed';
  if (trace.finalDecision.action === 'ask_blocking_questions') return 'awaiting_user';
  if (approvalPoints.some(point => ['required', 'requested', 'blocked'].includes(point.status))) return 'awaiting_user';
  if (toolSteps.some(step => step.executionStatus === 'requires_external_host' || step.executionStatus === 'planned_not_executed')) return 'awaiting_external_tool';
  if (completionEvidence.every(item => item.status === 'met')) return 'complete';
  return 'partial';
}

export function buildCopilotRuntimeSnapshot(input: BuildCopilotRuntimeSnapshotInput): CopilotRuntimeSnapshot {
  const stateMachine = buildRuntimeStateMachine(input.trace);
  const sourceDescriptors = buildRuntimeSourceDescriptors(input);
  const workingMemory = buildRuntimeWorkingMemory(input);
  const toolSteps = buildRuntimeToolSteps(input.trace, input.executionEvidence);
  const approvalPoints = buildApprovalPoints(input.trace);
  const completionEvidence = buildCompletionEvidence(input.trace, toolSteps, approvalPoints, input.document);
  const currentState = input.trace.statePath.length
    ? toRuntimeState(input.trace.statePath[input.trace.statePath.length - 1])
    : 'failed';

  const snapshot: CopilotRuntimeSnapshot = {
    currentState,
    finalAction: input.trace.finalDecision.action,
    stateMachine,
    sourceDescriptors,
    workingMemory,
    toolSteps,
    approvalPoints,
    completionEvidence,
    operatingPrinciples: [
      'Kullanici talebi ve ek dokuman ana gerceklik kaynagidir; eski dokuman veya workspace basligi yeni talebi kirletmez.',
      'Eksik bilgilerin hepsi ayni agirlikta degildir; etki ve geri donus maliyeti karar davranisini belirler.',
      'Model cikarimi, varsayim, acik konu ve dogrulanmis bilgi ayri yazilir.',
      'Calismayan araclar calismis gibi iddia edilmez; planlanan ile gerceklesen ayri izlenir.',
      'Kavramsal tasarim, sadece baslik doldurma degil; rol, ekran, veri, is kurali, istisna, KPI, UAT ve traceability uretir.',
      'Kalite dusukse neden gizlenmez; Review tarafinda repair ve hizli aksiyon verilir.',
    ],
    failureModes: [
      'Sparse talebi otomatik genel dokumana cevirmek.',
      'Eski SAP/IYS/D2D/digital-contract baglamlarini yeni talebe karistirmak.',
      'Resmi kaynak gerektiren mevzuat/API iddiasini dogrulanmis gibi yazmak.',
      'Browser/build/typecheck/export calismadan sonucu basarili gostermek.',
      'Soru sorarken onerilen cevap, gerekce ve dokuman etkisini vermemek.',
      'Dokumanda gereksinim -> is kurali -> kabul kriteri -> test bagini kurmamak.',
    ],
    completionStatus: 'partial',
  };

  return {
    ...snapshot,
    completionStatus: deriveCompletionStatus(input.trace, toolSteps, approvalPoints, completionEvidence),
  };
}

function renderList(items: string[], fallback: string): string {
  return items.length ? items.map(item => `- ${item}`).join('\n') : `- ${fallback}`;
}

function renderSourceDescriptors(descriptors: SourceDescriptor[]): string {
  return descriptors.map(source => [
    `- ${source.sourceId} (${source.type}) ${source.title}`,
    `  authority=${source.authority}; relevance=${source.relevance}/100; freshness=${source.freshness}; completeness=${source.completeness}; relation=${source.projectRelation}`,
    `  signals=${source.extractedSignals.slice(0, 6).join(' | ') || '[YOK]'}`,
    `  reliability=${source.reliabilityRule}`,
  ].join('\n')).join('\n');
}

function renderToolSteps(steps: RuntimeToolStep[]): string {
  return steps.map(step => [
    `- ${step.tool}: status=${step.executionStatus}; availability=${step.availability}`,
    `  evidence=${step.evidence}`,
    `  next=${step.nextAction}`,
  ].join('\n')).join('\n');
}

function renderApprovalPoints(points: RuntimeApprovalPoint[]): string {
  return points.map(point => (
    `- ${point.id}: ${point.topic}; status=${point.status}; owner=${point.owner}; before=${point.requiredBefore}; reason=${point.reason}`
  )).join('\n');
}

function renderCompletionEvidence(items: RuntimeCompletionEvidence[]): string {
  return items.map(item => (
    `- ${item.id} ${item.evidenceType}: status=${item.status}; confidence=${item.confidence}/100; ${item.statement} Next=${item.nextAction}`
  )).join('\n');
}

export function buildCopilotRuntimeInstruction(snapshot: CopilotRuntimeSnapshot): string {
  return `
[COPILOT RUNTIME STATE MACHINE - ACIKLAYICI TELEMETRI]
Bu katman calisma durumunu ve arac dogrulugunu izler; final aksiyonu veya artifact yapisini degistirmez. AiTurnDecision tek karar otoritesidir.

Current state: ${snapshot.currentState}
Runtime recommendation (otorite degil): ${snapshot.finalAction}
Completion status: ${snapshot.completionStatus}

State machine:
${snapshot.stateMachine.map(item => `- ${item.from} -> ${item.to}: status=${item.status}; guard=${item.guard}; operation=${item.operation}; failure=${item.failureAction}`).join('\n') || '- state transition yok'}

Source descriptors:
${renderSourceDescriptors(snapshot.sourceDescriptors)}

Working memory:
- projectSummary: ${snapshot.workingMemory.projectSummary}
- confirmedFacts: ${snapshot.workingMemory.confirmedFacts.slice(0, 8).join(' | ') || '[YOK]'}
- confirmedDecisions: ${snapshot.workingMemory.confirmedDecisions.slice(0, 8).join(' | ') || '[YOK]'}
- assumptions: ${snapshot.workingMemory.assumptions.slice(0, 8).join(' | ') || '[YOK]'}
- openQuestions: ${snapshot.workingMemory.openQuestions.slice(0, 8).join(' | ') || '[YOK]'}
- unresolvedConflicts: ${snapshot.workingMemory.unresolvedConflicts.slice(0, 8).join(' | ') || '[YOK]'}
- currentTask: ${snapshot.workingMemory.currentTask}

Tool execution truth:
${renderToolSteps(snapshot.toolSteps)}

Human approval points:
${renderApprovalPoints(snapshot.approvalPoints)}

Completion evidence:
${renderCompletionEvidence(snapshot.completionEvidence)}

Operating principles:
${renderList(snapshot.operatingPrinciples, 'principle yok')}

Failure modes to avoid:
${renderList(snapshot.failureModes, 'failure mode yok')}

Runtime kurallari:
- planned_not_executed, requires_external_host veya requires_human_approval durumundaki aracin sonucunu basariliymis gibi yazma.
- completionStatus awaiting_external_tool ise aracin calismadigini belirt ve dokuman iddialarini [DOGRULAMA GEREKIR] olarak ayir.
- Source descriptors icinde official_reference_required varsa mevzuat/API/SAP/IYS iddialarini DOGRULANDI yapma.
- Working memory ile son kullanici talebi celisirse son talep onceliklidir; celiskiyi Review'da goster.
`.trim();
}

function mdCell(value: string | number | undefined): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '/')
    .trim() || '[YOK]';
}

function reviewRows(headers: string[], rows: Array<Array<string | number | undefined>>): string[] {
  return [
    `| ${headers.map(mdCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(mdCell).join(' | ')} |`),
  ];
}

export function buildCopilotRuntimeReviewMarkdown(snapshot: CopilotRuntimeSnapshot): string {
  return [
    RUNTIME_REVIEW_START,
    '## Copilot Runtime State Machine',
    '',
    '| Alan | Deger |',
    '| --- | --- |',
    `| Current State | ${snapshot.currentState} |`,
    `| Final Action | ${snapshot.finalAction} |`,
    `| Completion Status | ${snapshot.completionStatus} |`,
    '',
    '### Cognitive State Machine',
    ...reviewRows(
      ['From', 'To', 'Status', 'Guard', 'Operation', 'Failure Action'],
      snapshot.stateMachine.map(item => [
        item.from,
        item.to,
        item.status,
        item.guard,
        item.operation,
        item.failureAction,
      ]),
    ),
    '',
    '### Source Descriptors',
    ...reviewRows(
      ['Source', 'Type', 'Authority', 'Relevance', 'Completeness', 'Relation', 'Signals', 'Rule'],
      snapshot.sourceDescriptors.map(item => [
        item.sourceId,
        item.type,
        item.authority,
        `${item.relevance}/100`,
        item.completeness,
        item.projectRelation,
        item.extractedSignals.join(' | '),
        item.reliabilityRule,
      ]),
    ),
    '',
    '### Working Memory',
    ...reviewRows(['Alan', 'Deger'], [
      ['Project summary', snapshot.workingMemory.projectSummary],
      ['Confirmed facts', snapshot.workingMemory.confirmedFacts.join(' | ')],
      ['Confirmed decisions', snapshot.workingMemory.confirmedDecisions.join(' | ')],
      ['Assumptions', snapshot.workingMemory.assumptions.join(' | ')],
      ['Rejected assumptions', snapshot.workingMemory.rejectedAssumptions.join(' | ')],
      ['Open questions', snapshot.workingMemory.openQuestions.join(' | ')],
      ['Stakeholders', snapshot.workingMemory.stakeholders.join(' | ')],
      ['Scope items', snapshot.workingMemory.scopeItems.join(' | ')],
      ['Business rules', snapshot.workingMemory.businessRules.join(' | ')],
      ['Artifacts', snapshot.workingMemory.artifacts.join(' | ')],
      ['User preferences', snapshot.workingMemory.userPreferences.join(' | ')],
      ['Unresolved conflicts', snapshot.workingMemory.unresolvedConflicts.join(' | ')],
      ['Current task', snapshot.workingMemory.currentTask],
    ]),
    '',
    '### Tool Execution Truth',
    ...reviewRows(
      ['Tool', 'Availability', 'Execution Status', 'Evidence', 'Honesty Rule', 'Next Action'],
      snapshot.toolSteps.map(step => [
        step.tool,
        step.availability,
        step.executionStatus,
        step.evidence,
        step.honestyRule,
        step.nextAction,
      ]),
    ),
    '',
    '### Human Approval Points',
    ...reviewRows(
      ['Id', 'Topic', 'Trigger', 'Before', 'Owner', 'Status', 'Reason'],
      snapshot.approvalPoints.map(point => [
        point.id,
        point.topic,
        point.trigger,
        point.requiredBefore,
        point.owner,
        point.status,
        point.reason,
      ]),
    ),
    '',
    '### Completion Evidence',
    ...reviewRows(
      ['Id', 'Type', 'Status', 'Confidence', 'Statement', 'Next Action'],
      snapshot.completionEvidence.map(item => [
        item.id,
        item.evidenceType,
        item.status,
        `${item.confidence}/100`,
        item.statement,
        item.nextAction,
      ]),
    ),
    '',
    '### Operating Principles',
    ...snapshot.operatingPrinciples.map(item => `- ${item}`),
    '',
    '### Runtime Failure Modes',
    ...snapshot.failureModes.map(item => `- ${item}`),
    RUNTIME_REVIEW_END,
  ].join('\n');
}
