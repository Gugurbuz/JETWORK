import type { DocumentData, KnowledgeItem, Message } from '../../types';
import type { SourceIntelligenceReport } from '../sourceIntelligence';
import type { ArtifactMode, BaCognitiveFrame, EvidenceClaim, InformationGap } from './baCognitiveFrame';
import type { BehaviorDecision } from './behaviorDecision';
import type { IntentClassification } from './intentTypes';
import type { AiTurnDecision } from './aiTurnDecision';

export type FinalAction =
  | 'answer_directly'
  | 'ask_blocking_questions'
  | 'draft_with_assumptions'
  | 'generate_source_grounded_draft'
  | 'revise_existing_artifact'
  | 'inspect_additional_sources'
  | 'inspect_repository'
  | 'design_solution'
  | 'implement_change'
  | 'validate_artifact'
  | 'repair_artifact'
  | 'request_human_approval'
  | 'stop_due_to_policy';

export type CopilotAgentType =
  | 'orchestrator'
  | 'business_analysis'
  | 'technical_analysis'
  | 'sap_domain'
  | 'ui_ux'
  | 'coding'
  | 'test'
  | 'research'
  | 'quality';

export type CopilotToolType =
  | 'project_memory'
  | 'source_reader'
  | 'web_research'
  | 'repo_search'
  | 'code_editor'
  | 'typecheck'
  | 'build'
  | 'browser_test'
  | 'document_export'
  | 'human_approval';

export interface UserSignals {
  mustGenerateNow: boolean;
  wantsClarificationFirst: boolean;
  allowsAssumptions: boolean;
  wantsDetailedOutput: boolean;
  wantsTechnicalOutput: boolean;
  wantsDocumentChange: boolean;
  selectedTextOnly: boolean;
  requestsToolUsage: boolean;
}

export interface ConfidenceProfile {
  intentConfidence: number;
  sourceConfidence: number;
  problemFrameConfidence: number;
  domainConfidence: number;
  solutionConfidence: number;
  artifactConfidence: number;
  validationConfidence: number;
}

export interface FinalTurnDecision {
  action: FinalAction;
  rationaleCodes: string[];
  userExplanation: string;
  requiredAgents: CopilotAgentType[];
  requiredTools: CopilotToolType[];
  outputPlan: string[];
  validationPlan: string[];
}

export interface WorkingMemorySnapshot {
  confirmedFacts: string[];
  assumptions: string[];
  openQuestions: string[];
  userPreferences: string[];
  unresolvedConflicts: string[];
}

export type CopilotEvidenceStatus =
  | 'DOGRULANDI'
  | 'CIKARIM'
  | 'VARSAYIM'
  | 'CELISKI'
  | 'ACIK_KONU';

export type GapResolutionDecision =
  | 'ask_now'
  | 'assume_and_mark'
  | 'verify_with_source'
  | 'block_until_source';

export interface ProblemFrameSnapshot {
  businessProblem: string;
  desiredOutcome: string;
  currentState: string;
  targetState: string;
  stakeholders: string[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  successMetrics: string[];
}

export interface EvidenceLedgerEntry {
  id: string;
  claim: string;
  status: CopilotEvidenceStatus;
  confidence: number;
  source: string;
  usage: string;
  requiredAction: string;
}

export interface GapDecision {
  topic: string;
  impact: InformationGap['impact'];
  reversibility: InformationGap['reversibility'];
  decision: GapResolutionDecision;
  reason: string;
  question?: string;
  assumption?: string;
}

export interface AgentTaskPlanItem {
  id: string;
  agent: CopilotAgentType;
  objective: string;
  inputSignals: string[];
  expectedOutput: string;
  evidenceRule: string;
  validationRule: string;
  status: 'planned';
}

export interface ToolExecutionPlanItem {
  tool: CopilotToolType;
  availability: 'available_now' | 'available_when_routed' | 'external_host_required' | 'human_approval_required';
  purpose: string;
  honestyRule: string;
}

export interface ArtifactContractSnapshot {
  mode: ArtifactMode;
  visibleSections: Array<'businessAnalysis' | 'review'>;
  mustInclude: string[];
  sourcePolicy: string[];
  forbiddenPatterns: string[];
  qualityGates: string[];
}

export interface ValidationLoopItem {
  stage: 'pre_generation' | 'post_generation' | 'repair' | 'handoff';
  check: string;
  failureAction: string;
}

export interface TraceabilityMatrixRow {
  sourceSignal: string;
  decision: string;
  artifactTarget: string;
  validation: string;
  status: CopilotEvidenceStatus;
}

export interface CopilotCognitiveTrace {
  statePath: string[];
  userSignals: UserSignals;
  confidence: ConfidenceProfile;
  workingMemory: WorkingMemorySnapshot;
  problemFrame: ProblemFrameSnapshot;
  evidenceLedger: EvidenceLedgerEntry[];
  gapDecisions: GapDecision[];
  taskPlan: AgentTaskPlanItem[];
  toolExecutionPlan: ToolExecutionPlanItem[];
  artifactContract: ArtifactContractSnapshot;
  traceabilityMatrix: TraceabilityMatrixRow[];
  validationLoop: ValidationLoopItem[];
  finalDecision: FinalTurnDecision;
}

interface BuildCopilotCognitiveTraceInput {
  userMessage: string;
  messages?: Message[];
  knowledgeBase?: KnowledgeItem[];
  document: DocumentData | null;
  hasSelectedText: boolean;
  classification: IntentClassification;
  behaviorDecision: BehaviorDecision;
  sourceReport: SourceIntelligenceReport;
  cognitiveFrame: BaCognitiveFrame;
  turnDecision?: AiTurnDecision;
  discoverySignals: {
    mustGenerateNow?: boolean;
    greetingOnly?: boolean;
    newStandaloneRequest?: boolean;
    reason?: string;
  };
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const normalizeText = (value = ''): string => value
  .toLocaleLowerCase('tr-TR')
  .replace(/\u0131/g, 'i')
  .replace(/\u015f/g, 's')
  .replace(/\u011f/g, 'g')
  .replace(/\u00fc/g, 'u')
  .replace(/\u00f6/g, 'o')
  .replace(/\u00e7/g, 'c');

const unique = <T,>(items: T[]): T[] => Array.from(new Set(items.filter(Boolean)));

function documentHasContent(document: DocumentData | null): boolean {
  if (!document) return false;
  return Object.values(document as any).some(
    (section: any) => section?.content && String(section.content).trim().length > 0,
  );
}

function buildUserSignals(input: BuildCopilotCognitiveTraceInput): UserSignals {
  const text = normalizeText(input.userMessage);
  const explicitGenerate = /\b(hazirla|olustur|uret|yaz|taslak|cikar|dokuman|rapor|kavramsal|fdd|brd)\b/.test(text);
  const allowsAssumptions = input.behaviorDecision.shouldUseAssumptions
    || /\b(varsayim|mevcut bilgilerle|bu bilgilerle|soru sorma|devam et|sen yap)\b/.test(text);

  return {
    mustGenerateNow: !!input.discoverySignals.mustGenerateNow || explicitGenerate && allowsAssumptions,
    wantsClarificationFirst: input.behaviorDecision.shouldAskQuestions && !allowsAssumptions,
    allowsAssumptions,
    wantsDetailedOutput: /\b(detay|derin|kapsamli|eksiksiz|word|kavramsal|fdd|brd)\b/.test(text),
    wantsTechnicalOutput: /\b(teknik|api|entegrasyon|kod|repository|build|test|mimari)\b/.test(text),
    wantsDocumentChange: input.behaviorDecision.shouldUpdateDocument || input.classification.documentImpact === 'updates_document',
    selectedTextOnly: input.hasSelectedText && /\b(secil[iı]|selected|bu paragraf|bu kisim)\b/.test(text),
    requestsToolUsage: /\b(test et|tarayici|browser|repo|kod|build|typecheck|deploy|canli)\b/.test(text),
  };
}

function statusRank(gap: InformationGap): number {
  const impactRank: Record<string, number> = { blocking: 4, high: 3, medium: 2, low: 1 };
  const reversibilityRank: Record<string, number> = { expensive: 3, moderate: 2, easy: 1 };
  return (impactRank[gap.impact] || 0) * 10 + (reversibilityRank[gap.reversibility] || 0);
}

function buildWorkingMemory(input: BuildCopilotCognitiveTraceInput): WorkingMemorySnapshot {
  const recentUserPreferences = (input.messages || [])
    .slice(-12)
    .map(message => message.text || '')
    .filter(text => /\b(word format|soru sorma|varsay|review|flow|it analiz|test|kavramsal)\b/i.test(text))
    .slice(-6);

  return {
    confirmedFacts: input.cognitiveFrame.facts.slice(0, 8),
    assumptions: input.cognitiveFrame.evidenceClaims
      .filter(claim => claim.status === 'assumed')
      .map(claim => claim.claim)
      .slice(0, 8),
    openQuestions: input.cognitiveFrame.informationGaps
      .slice()
      .sort((a, b) => statusRank(b) - statusRank(a))
      .map(gap => gap.question || gap.topic)
      .slice(0, 8),
    userPreferences: recentUserPreferences,
    unresolvedConflicts: input.sourceReport.mismatchWarnings.slice(0, 6),
  };
}

function buildProblemFrameSnapshot(frame: BaCognitiveFrame): ProblemFrameSnapshot {
  const problem = frame.problemFrame;
  return {
    businessProblem: problem.businessProblem,
    desiredOutcome: problem.desiredOutcome,
    currentState: problem.currentState,
    targetState: problem.targetState,
    stakeholders: problem.stakeholders.map(item => `${item.name} (${item.evidenceStatus})`).slice(0, 10),
    inScope: problem.scope.inScope.slice(0, 12),
    outOfScope: problem.scope.outOfScope.slice(0, 8),
    constraints: problem.constraints.map(item => `${item.topic}: ${item.description}`).slice(0, 8),
    successMetrics: problem.successMetrics.map(item => `${item.name}: ${item.target} (${item.evidenceStatus})`).slice(0, 8),
  };
}

function mapEvidenceStatus(claim: EvidenceClaim): CopilotEvidenceStatus {
  if (claim.status === 'supported') return 'DOGRULANDI';
  if (claim.status === 'inferred') return 'CIKARIM';
  if (claim.status === 'assumed') return 'VARSAYIM';
  return 'CELISKI';
}

function requiredActionForEvidence(status: CopilotEvidenceStatus): string {
  const map: Record<CopilotEvidenceStatus, string> = {
    DOGRULANDI: 'Dokumanda karar zemini olarak kullan; kaynakla celisme.',
    CIKARIM: 'Cikarim olarak yaz; kesin hukum veya resmi kaynak iddiasi yapma.',
    VARSAYIM: 'Dokumanda [VARSAYIM] etiketiyle kullan ve Review acik konusuna bagla.',
    CELISKI: 'Uretim oncesi kaynak onceligi belirle; celiskiyi Review tarafinda gorunur yap.',
    ACIK_KONU: 'Dogrulama veya kullanici karari gelene kadar kesin bilgi gibi yazma.',
  };
  return map[status];
}

function needsOfficialValidation(report: SourceIntelligenceReport): boolean {
  return report.domainHints.some(hint => ['iys', 'sap'].includes(hint))
    || report.integrations.some(item => /\b(api|sap|iys|oauth|mevzuat|kanun|dis)\b/i.test(item));
}

function isOfficialClaimLike(value = ''): boolean {
  return /\b(api|oauth|sap|iys|kkb|findeks|kvkk|mevzuat|kanun|resmi|rate limit|yasal|muvafakat)\b/i.test(value);
}

function buildEvidenceLedger(input: BuildCopilotCognitiveTraceInput): EvidenceLedgerEntry[] {
  const officialRequired = input.turnDecision?.sourcePolicy.officialSourceRequired ?? needsOfficialValidation(input.sourceReport);
  const canClaimVerified = input.turnDecision?.sourcePolicy.canClaimVerified ?? !officialRequired;
  const rows: EvidenceLedgerEntry[] = input.cognitiveFrame.evidenceClaims.map((claim, index) => {
    const initialStatus = mapEvidenceStatus(claim);
    const officialClaim = isOfficialClaimLike([
      claim.claim,
      claim.usage,
      claim.sourceId || '',
    ].join(' '));
    const status = initialStatus === 'DOGRULANDI' && officialRequired && !canClaimVerified && officialClaim
      ? 'ACIK_KONU'
      : initialStatus;
    return {
      id: `EVD-${String(index + 1).padStart(2, '0')}`,
      claim: claim.claim,
      status,
      confidence: clamp(claim.confidence),
      source: claim.sourceId || 'cognitive_frame',
      usage: claim.usage,
      requiredAction: status === 'ACIK_KONU' && initialStatus === 'DOGRULANDI'
        ? 'Resmi kaynak/guncel dokuman gelmeden bu iddiayi DOGRULANDI yapma.'
        : requiredActionForEvidence(status),
    };
  });

  if (officialRequired) {
    rows.push({
      id: `EVD-${String(rows.length + 1).padStart(2, '0')}`,
      claim: 'Mevzuat, SAP, IYS, KKB, Findeks veya API kurallari resmi kaynak/guncel dokumanla dogrulanmadan DOGRULANDI sayilmaz.',
      status: 'ACIK_KONU',
      confidence: 92,
      source: input.turnDecision ? 'ai_turn_decision.source_policy' : 'official_source_required',
      usage: 'Review kaynak ayrimi, mevzuat/API kararlari ve teknik limitler',
      requiredAction: requiredActionForEvidence('ACIK_KONU'),
    });
  }

  input.sourceReport.openTopics.slice(0, 4).forEach((topic) => {
    rows.push({
      id: `EVD-${String(rows.length + 1).padStart(2, '0')}`,
      claim: topic,
      status: 'ACIK_KONU',
      confidence: 80,
      source: 'source_intelligence.open_topics',
      usage: 'Review acik konular ve sonraki aksiyonlar',
      requiredAction: requiredActionForEvidence('ACIK_KONU'),
    });
  });

  return rows.slice(0, 16);
}

function decideGapResolution(gap: InformationGap, sourceSensitive: boolean): GapResolutionDecision {
  if (gap.impact === 'blocking' && !gap.canAssume) return 'block_until_source';
  if (gap.impact === 'high' && gap.reversibility === 'expensive' && !gap.canAssume) return 'ask_now';
  if (sourceSensitive && (gap.impact === 'high' || gap.reversibility === 'expensive')) return 'verify_with_source';
  if (gap.canAssume) return 'assume_and_mark';
  return 'ask_now';
}

function buildGapDecisions(input: BuildCopilotCognitiveTraceInput): GapDecision[] {
  const sourceSensitive = needsOfficialValidation(input.sourceReport);
  return input.cognitiveFrame.informationGaps
    .slice()
    .sort((a, b) => statusRank(b) - statusRank(a))
    .slice(0, 12)
    .map((gap) => {
      const decision = decideGapResolution(gap, sourceSensitive);
      const decisionReason = decision === 'block_until_source'
        ? 'Bloklayici eksik; kaynak veya kullanici karari olmadan uretilen cikti yanlis yonlendirir.'
        : decision === 'ask_now'
          ? 'Yuksek etkili ve geri donusu pahali karar; insansi BA once bunu netlestirir.'
          : decision === 'verify_with_source'
            ? 'Kaynak hassas konu; resmi/guncel kaynakla dogrulama gerekmeden kesin karar yazilmaz.'
            : 'Varsayilabilir bosluk; dokumanda isaretli varsayim ve Review acik konusu olarak ilerlenebilir.';
      return {
        topic: gap.topic,
        impact: gap.impact,
        reversibility: gap.reversibility,
        decision,
        reason: `${gap.reason} ${decisionReason}`.trim(),
        question: gap.question,
        assumption: gap.proposedAssumption,
      };
    });
}

function buildConfidenceProfile(input: BuildCopilotCognitiveTraceInput): ConfidenceProfile {
  const highRiskGaps = input.cognitiveFrame.informationGaps.filter(
    gap => gap.impact === 'blocking' || gap.impact === 'high',
  ).length;
  const hasDomain = input.sourceReport.domainHints.length > 0 || input.behaviorDecision.domain !== 'generic_ba';
  const hasDocument = documentHasContent(input.document);

  return {
    intentConfidence: clamp((input.classification.confidence || 0.5) * 100),
    sourceConfidence: clamp(input.sourceReport.confidence),
    problemFrameConfidence: clamp(input.cognitiveFrame.confidence - highRiskGaps * 8),
    domainConfidence: clamp((hasDomain ? 72 : 45) + input.sourceReport.systems.length * 4 + input.sourceReport.integrations.length * 3),
    solutionConfidence: clamp(input.cognitiveFrame.coverageSummary.score - highRiskGaps * 6),
    artifactConfidence: clamp(input.cognitiveFrame.coverageSummary.score + (hasDocument ? 8 : 0)),
    validationConfidence: clamp(input.cognitiveFrame.coverageSummary.coveredCount * 8 + input.cognitiveFrame.coverageSummary.partialCount * 4),
  };
}

function resolveAction(input: BuildCopilotCognitiveTraceInput, signals: UserSignals): FinalAction {
  if (input.discoverySignals.greetingOnly || input.behaviorDecision.mode === 'chat_only') return 'answer_directly';
  if (input.classification.requiresPreview || input.classification.documentImpact === 'requires_user_confirmation') return 'request_human_approval';
  if (signals.requestsToolUsage && /\b(kod|repository|repo|implement|fix|bug)\b/i.test(input.userMessage)) return 'inspect_repository';
  if (input.cognitiveFrame.action === 'block_until_source') return 'ask_blocking_questions';
  if (input.cognitiveFrame.action === 'ask_first' && !signals.mustGenerateNow) return 'ask_blocking_questions';
  if (input.behaviorDecision.shouldUpdateDocument && documentHasContent(input.document)) return 'revise_existing_artifact';
  if (input.cognitiveFrame.action === 'draft_source_grounded') return 'generate_source_grounded_draft';
  if (input.behaviorDecision.shouldUpdateDocument || signals.mustGenerateNow || input.cognitiveFrame.action === 'draft_with_assumptions') return 'draft_with_assumptions';
  if (input.classification.primaryIntent === 'quality_review') return 'validate_artifact';
  if (input.classification.primaryIntent === 'document_editing') return 'revise_existing_artifact';
  if (input.classification.primaryIntent === 'research') return 'inspect_additional_sources';
  return 'answer_directly';
}

function selectAgents(input: BuildCopilotCognitiveTraceInput, action: FinalAction): CopilotAgentType[] {
  const agents: CopilotAgentType[] = ['orchestrator'];
  const text = normalizeText(input.userMessage);

  if (input.behaviorDecision.shouldUpdateDocument || action.includes('draft') || action.includes('artifact')) agents.push('business_analysis', 'quality');
  if (input.behaviorDecision.shouldUseResearch || input.sourceReport.confidence < 45 || action === 'inspect_additional_sources') agents.push('research');
  if (input.behaviorDecision.domain !== 'generic_ba' && /\b(sap|crm|c4c|is-u|fika|fi-ca|iys)\b/.test(text)) agents.push('sap_domain');
  if (input.classification.baAgentFocus === 'technical_analysis' || /\b(teknik|api|entegrasyon|mimari|servis)\b/.test(text)) agents.push('technical_analysis');
  if (/\b(ekran|ui|ux|toast|validasyon|modal|form|dropdown)\b/.test(text)) agents.push('ui_ux');
  if (/\b(test|uat|kabul kriter|qa|regresyon)\b/.test(text)) agents.push('test');
  if (/\b(kod|repo|implement|fix|bug|component|build)\b/.test(text)) agents.push('coding', 'test');

  return unique(agents);
}

function selectTools(input: BuildCopilotCognitiveTraceInput, action: FinalAction): CopilotToolType[] {
  const tools: CopilotToolType[] = ['project_memory', 'source_reader'];
  const text = normalizeText(input.userMessage);

  if (input.behaviorDecision.shouldUseResearch || /\b(mevzuat|guncel|api dokuman|resmi kaynak)\b/.test(text)) tools.push('web_research');
  if (action === 'inspect_repository' || /\b(kod|repo|repository|component)\b/.test(text)) tools.push('repo_search');
  if (/\b(implement|gelistir|fix|duzelt|kodla)\b/.test(text)) tools.push('code_editor', 'typecheck', 'build');
  if (/\b(tarayici|browser|canli test|ui test|test et)\b/.test(text)) tools.push('browser_test');
  if (/\b(word|indir|export|docx)\b/.test(text)) tools.push('document_export');
  if (input.classification.requiresPreview || input.classification.documentImpact === 'requires_user_confirmation') tools.push('human_approval');

  return unique(tools);
}

function toolPurpose(tool: CopilotToolType): string {
  const purposes: Record<CopilotToolType, string> = {
    project_memory: 'Workspace karar ve tercih hafizasini okuma/yazma.',
    source_reader: 'Kullanici mesaji, sohbet gecmisi ve mevcut dokumandan kaynak sinyali cikarma.',
    web_research: 'Mevzuat/API/resmi kaynak gerektiren konularda web/grounding arastirmasi.',
    repo_search: 'Kod deposu, dosya ve implementation baglamini inceleme.',
    code_editor: 'Kod degisikligi uygulama.',
    typecheck: 'Tip kontrolu ve statik dogrulama calistirma.',
    build: 'Uretim build/paketleme dogrulamasi calistirma.',
    browser_test: 'UI/canli uygulama akisini tarayici ile dogrulama.',
    document_export: 'Dokumani disari aktarim/indirme formatina hazirlama.',
    human_approval: 'Yuksek riskli karar veya dis sisteme yazma onayi alma.',
  };
  return purposes[tool];
}

function toolAvailability(tool: CopilotToolType): ToolExecutionPlanItem['availability'] {
  if (tool === 'project_memory' || tool === 'source_reader') return 'available_now';
  if (tool === 'web_research' || tool === 'document_export') return 'available_when_routed';
  if (tool === 'human_approval') return 'human_approval_required';
  return 'external_host_required';
}

function toolHonestyRule(tool: CopilotToolType, availability: ToolExecutionPlanItem['availability']): string {
  if (availability === 'available_now') return 'Bu arac kullanilabilir; sonucunu trace/review tarafinda belirt.';
  if (availability === 'available_when_routed') return 'Bu arac yalniz ilgili route/entegrasyon calistirildiginda kullanilmis sayilir; aksi halde plan olarak yaz.';
  if (availability === 'human_approval_required') return 'Onay alinmadan uygulanmis gibi davranma.';
  return `${tool} uygulama icinde dogrudan calistirilamaz; dis host/Codex veya gelistirme ortami gerekir. Calistirmadiysan sonuc iddia etme.`;
}

function buildToolExecutionPlan(tools: CopilotToolType[]): ToolExecutionPlanItem[] {
  return tools.map(tool => {
    const availability = toolAvailability(tool);
    return {
      tool,
      availability,
      purpose: toolPurpose(tool),
      honestyRule: toolHonestyRule(tool, availability),
    };
  });
}

function buildStatePath(action: FinalAction): string[] {
  const base = [
    'receive_request',
    'understand_intent',
    'load_memory',
    'inspect_sources',
    'frame_problem',
    'identify_gaps',
    'resolve_action',
  ];
  if (action === 'ask_blocking_questions') return [...base, 'ask_questions'];
  if (action === 'inspect_repository') return [...base, 'create_plan', 'select_tools', 'execute_tools', 'generate_artifact', 'validate_artifact'];
  if (action === 'request_human_approval') return [...base, 'request_approval'];
  if (action === 'validate_artifact') return [...base, 'validate_artifact', 'repair_artifact'];
  if (action.includes('draft') || action.includes('artifact')) return [...base, 'create_plan', 'select_agents', 'generate_artifact', 'validate_artifact', 'repair_artifact', 'complete'];
  return [...base, 'complete'];
}

function rationaleCodes(input: BuildCopilotCognitiveTraceInput, action: FinalAction): string[] {
  return unique([
    `action:${action}`,
    `behavior:${input.behaviorDecision.mode}`,
    `domain:${input.behaviorDecision.domain}`,
    `artifact:${input.cognitiveFrame.artifactMode}`,
    `source:${input.cognitiveFrame.sourceRichness}`,
    `coverage:${input.cognitiveFrame.coverageSummary.score}`,
    input.discoverySignals.reason ? `signal:${input.discoverySignals.reason}` : '',
  ]);
}

function userExplanation(action: FinalAction): string {
  const map: Record<FinalAction, string> = {
    answer_directly: 'Bu turda dokuman veya kod degisikligi gerekmiyor; kisa ve baglama uygun cevap ver.',
    ask_blocking_questions: 'Sonucu ciddi degistirecek karar bosluklari var; sadece yuksek etkili kritik sorulari sor.',
    draft_with_assumptions: 'Kullanici dokuman/analiz cikti istiyor; dusuk ve orta etkili bosluklari isaretli varsayimla doldur.',
    generate_source_grounded_draft: 'Kaynak zengin; kaynak iddialarini DOGRULANDI/CIKARIM/VARSAYIM olarak ayirarak taslak uret.',
    revise_existing_artifact: 'Mevcut dokumani koruyarak ilgili bolumleri guncelle ve etkileri Review tarafinda goster.',
    inspect_additional_sources: 'Cevap icin ek kaynak incelemesi gerekiyor; kaynak ve guven ayrimini koru.',
    inspect_repository: 'Kod veya repo etkisi var; once repository yapisini incele, sonra degisiklik planla.',
    design_solution: 'Cozum tasarimi gerekiyor; problem ve alternatif cozumleri ayir.',
    implement_change: 'Kod degisikligi gerekiyor; minimal patch ve dogrulama ile ilerle.',
    validate_artifact: 'Mevcut cikti kalite kapisindan gecirilmeli.',
    repair_artifact: 'Kalite bulgularina gore cikti otomatik onarilmali.',
    request_human_approval: 'Yuksek riskli veya dis sisteme yazan islem icin kullanici onayi gerekir.',
    stop_due_to_policy: 'Guvenlik veya yetki nedeniyle islem durdurulmali.',
  };
  return map[action];
}

function validationPlan(input: BuildCopilotCognitiveTraceInput, action: FinalAction): string[] {
  const base = [
    'ProblemFrame, kaynak iddialari ve varsayim/acik konu ayrimini kontrol et.',
    'Coverage: aktor, akis, istisna, is kurali, validasyon, veri, entegrasyon, NFR, rapor ve audit alanlarini kontrol et.',
    'Review: risk, acik konu, kalite puani ve sonraki aksiyonlar gorunur mu kontrol et.',
  ];
  if (action === 'inspect_repository' || action === 'implement_change') {
    base.push('Kod degisikligi varsa typecheck/build/test sonucunu kanit olarak ayir.');
  }
  if (input.behaviorDecision.domain !== 'generic_ba') {
    base.push('Domain iddialarinda dogrulanmis bilgi ile Enerjisa/custom varsayimini ayir.');
  }
  return base;
}

function agentObjective(agent: CopilotAgentType): string {
  const objectives: Record<CopilotAgentType, string> = {
    orchestrator: 'Niyet, kaynak, risk, final aksiyon ve cikti kontratini birlestir.',
    business_analysis: 'ProblemFrame, surec modeli, is kurallari, gereksinimler, KPI ve kabul kriterlerini uret.',
    technical_analysis: 'Veri, entegrasyon, hata, audit, guvenlik, performans ve operasyon sorumluluklarini tasarla.',
    sap_domain: 'SAP/IYS/CRM gibi domain iddialarini varsayim, cikarim ve dogrulanmis bilgi olarak ayir.',
    ui_ux: 'Ekran davranisi, form state, validasyon, toast/modal ve kullanici mesajlarini detaylandir.',
    coding: 'Kod/repo etkisi varsa uygulanabilir degisiklikleri ve dogrulama ihtiyacini belirle.',
    test: 'UAT, negatif senaryo, yetki, entegrasyon hata ve regresyon kontrollerini yaz.',
    research: 'Resmi kaynak/guncel dokuman gerektiren iddialari tespit et ve kaynak politikasini kur.',
    quality: 'Coverage, traceability, celiski, kalite puani ve repair aksiyonlarini denetle.',
  };
  return objectives[agent];
}

function taskExpectedOutput(agent: CopilotAgentType): string {
  const outputs: Record<CopilotAgentType, string> = {
    orchestrator: 'FinalAction, task plan, validation loop ve kisa kullanici mesaji.',
    business_analysis: 'Karar verilebilir BA/kavramsal tasarim omurgasi.',
    technical_analysis: 'Teknik kapsam, veri/entegrasyon ve NFR karar seti.',
    sap_domain: 'Domain varsayimlari, dogrulanacak kararlar ve riskler.',
    ui_ux: 'Ekran, durum, mesaj, validasyon ve gorev/bildirim gereksinimleri.',
    coding: 'Repo inceleme/degisiklik plani veya uygulanan kod patch ozeti.',
    test: 'Test/UAT matrisi ve kabul kanitlari.',
    research: 'Kaynak matrisi: DOGRULANDI / CIKARIM / VARSAYIM / ACIK KONU.',
    quality: 'Quality gate sonucu, eksikler, repair notlari ve hizli aksiyonlar.',
  };
  return outputs[agent];
}

function buildTaskPlan(
  input: BuildCopilotCognitiveTraceInput,
  agents: CopilotAgentType[],
  tools: CopilotToolType[],
  action: FinalAction,
  gapDecisions: GapDecision[],
): AgentTaskPlanItem[] {
  const inputSignals = unique([
    `action:${action}`,
    `artifact:${input.cognitiveFrame.artifactMode}`,
    `source:${input.cognitiveFrame.sourceRichness}`,
    `coverage:${input.cognitiveFrame.coverageSummary.score}`,
    input.sourceReport.inferredProjectName ? `project:${input.sourceReport.inferredProjectName}` : '',
    gapDecisions.some(gap => gap.decision === 'ask_now' || gap.decision === 'block_until_source') ? 'critical_gaps:true' : '',
    tools.length ? `tools:${tools.join(',')}` : '',
  ]);

  return agents.map((agent, index) => ({
    id: `TASK-${String(index + 1).padStart(2, '0')}`,
    agent,
    objective: agentObjective(agent),
    inputSignals,
    expectedOutput: taskExpectedOutput(agent),
    evidenceRule: agent === 'research' || agent === 'sap_domain'
      ? 'Resmi/guncel kaynak olmadan mevzuat/API/domain iddiasini DOGRULANDI yapma.'
      : 'Her kritik karar icin DOGRULANDI, CIKARIM, VARSAYIM, CELISKI veya ACIK_KONU durumu yaz.',
    validationRule: agent === 'quality'
      ? 'Coverage ve traceability eksikse ciktiyi NEEDS_REVISION yap ve repair aksiyonu uret.'
      : 'Cikti artifact kontratina ve validation loop kontrollerine baglanmali.',
    status: 'planned',
  }));
}

function mustIncludeForMode(mode: ArtifactMode): string[] {
  const shared = [
    'ProblemFrame: is problemi, hedef sonuc, mevcut durum, hedef durum, paydas, kapsam, kisit ve KPI.',
    'Evidence ledger: DOGRULANDI / CIKARIM / VARSAYIM / CELISKI / ACIK_KONU ayrimi.',
    'InformationGap matrisi: etki, geri donus maliyeti, varsayilabilirlik ve aksiyon.',
    'Traceability: kaynak sinyali -> karar -> gereksinim -> test/kabul kriteri baglantisi.',
  ];
  const byMode: Record<ArtifactMode, string[]> = {
    conceptual_analysis: [
      'Surec modeli bloklari, BR/FR/NFR/INT/RPT/SEC gereksinimler, veri, entegrasyon, UI/validasyon, UAT ve degisim yonetimi.',
    ],
    process_design: [
      'Happy path, alternatif akis, istisna akis, durum gecisleri, aktor/rol ve operasyon kapanis kriterleri.',
    ],
    user_story: [
      'Persona, hedef, is degeri, kabul kriterleri, bagimlilik, DoR/DoD ve test notlari.',
    ],
    acceptance_criteria: [
      'Given/When/Then, pozitif/negatif/sinir/yetki senaryolari ve on kosullar.',
    ],
    test_scenario: [
      'On kosul, test verisi, adimlar, beklenen sonuc, negatif/alternatif/sinir ve regresyon kapsami.',
    ],
    technical_analysis: [
      'Component, API/servis, veri modeli, hata/retry/logging/audit/guvenlik/performans/deployment.',
    ],
    api_specification: [
      'Endpoint, auth, request/response, hata kodlari, idempotency, rate limit, retry ve contract test.',
    ],
    data_model: [
      'Entity, alan, tip, zorunluluk, sahiplik, lifecycle, mapping, migration ve audit.',
    ],
    ui_specification: [
      'Ekran state, aksiyon, form alanlari, validasyon, toast/modal, bos/hata durumlari ve erisilebilirlik.',
    ],
  };
  return [...shared, ...byMode[mode]];
}

function buildArtifactContract(input: BuildCopilotCognitiveTraceInput): ArtifactContractSnapshot {
  const turnSourcePolicy = input.turnDecision
    ? [
      `AI Turn Decision action=${input.turnDecision.action}, profile=${input.turnDecision.artifactProfile.id}.`,
      `Official source required=${input.turnDecision.sourcePolicy.officialSourceRequired ? 'yes' : 'no'}, canClaimVerified=${input.turnDecision.sourcePolicy.canClaimVerified ? 'yes' : 'no'}.`,
      input.turnDecision.sourcePolicy.canClaimVerified
        ? 'DOGRULANDI etiketi kaynak/kanit destekli kritik iddialarda kullanilabilir.'
        : 'DOGRULANDI etiketi resmi kaynak gerektiren mevzuat/API/SAP/KKB/IYS iddialarinda kullanilamaz; ACIK_KONU veya VARSAYIM olarak kalir.',
    ]
    : [];
  return {
    mode: input.cognitiveFrame.artifactMode,
    visibleSections: ['businessAnalysis', 'review'],
    mustInclude: unique([
      ...mustIncludeForMode(input.cognitiveFrame.artifactMode),
      ...input.cognitiveFrame.documentContract,
    ]).slice(0, 12),
    sourcePolicy: [
      ...turnSourcePolicy,
      'Kullanici talebi ve ek dokuman ana gerceklik kaynagidir.',
      'Workspace basligi kaynak dokumanla celisirse kaynak dokuman onceliklidir.',
      'Resmi mevzuat/API/SAP iddialari guncel kaynak olmadan DOGRULANDI yapilmaz.',
      'Modelin tahminleri [VARSAYIM], cikarimlari [CIKARIM], eksik kararlar [ACIK KONU] olarak yazilir.',
    ],
    forbiddenPatterns: [
      'Genel sablon basliklarini kaynak sureclerin yerine kullanma.',
      'Kaynakta olmayan domain, sistem, mikroservis, ekran veya mevzuat kararini kesin bilgi gibi yazma.',
      'Ayri code/test/bpmn sekmelerini yeni uretimde ana yuzey gibi kullanma.',
      'Kalite puani dusukse nedeni gizleme veya "taslak tamam" diye sunma.',
    ],
    qualityGates: [
      'businessAnalysis karar verilebilir detayda olmalidir.',
      'review kaynak/dogrulama, risk, varsayim, acik konu, kalite ve hizli aksiyon icermelidir.',
      'Coverage: aktor, akis, istisna, is kurali, validasyon, yetki, veri, entegrasyon, NFR, rapor ve audit kontrol edilir.',
      'Traceability ve evidence ledger yoksa cikti NEEDS_REVISION kabul edilir.',
    ],
  };
}

function buildValidationLoop(
  input: BuildCopilotCognitiveTraceInput,
  gapDecisions: GapDecision[],
  action: FinalAction,
): ValidationLoopItem[] {
  const hasBlockingGap = gapDecisions.some(gap => gap.decision === 'block_until_source');
  const hasAskGap = gapDecisions.some(gap => gap.decision === 'ask_now');
  return [
    {
      stage: 'pre_generation',
      check: 'ProblemFrame, kaynak onceligi, final action ve gap kararlari tutarli mi?',
      failureAction: hasBlockingGap || (hasAskGap && action === 'ask_blocking_questions')
        ? 'Dokuman uretimini durdur; en fazla 3-5 kritik soru sor.'
        : 'Eksikleri [VARSAYIM] veya [ACIK KONU] olarak isaretleyerek ilerle.',
    },
    {
      stage: 'post_generation',
      check: 'Artifact contract mustInclude maddeleri businessAnalysis/review icinde karsilandi mi?',
      failureAction: 'Self-review repair uygula; eksik coverage ve traceability bloklarini ekle.',
    },
    {
      stage: 'repair',
      check: 'Yanlis baglam, kaynak celiskisi, domain kontaminasyonu veya unsupported claim var mi?',
      failureAction: 'Review status NEEDS_REVISION; celiskiyi ve duzeltme aksiyonunu gorunur yap.',
    },
    {
      stage: 'handoff',
      check: 'Kullanici mesajinda ne yapildigi, kalite puani nedeni ve hizli aksiyonlar net mi?',
      failureAction: 'Kisa ozet, kalan risk ve sonraki gelistirme aksiyonlarini yeniden yaz.',
    },
  ];
}

function buildTraceabilityMatrix(
  evidenceLedger: EvidenceLedgerEntry[],
  gapDecisions: GapDecision[],
): TraceabilityMatrixRow[] {
  const evidenceRows = evidenceLedger.slice(0, 8).map(entry => ({
    sourceSignal: entry.claim,
    decision: entry.requiredAction,
    artifactTarget: entry.usage,
    validation: entry.status === 'DOGRULANDI'
      ? 'Dokumanda kaynakla celismeden kullanilmali.'
      : entry.status === 'ACIK_KONU'
        ? 'Review acik konu/aksiyon listesine baglanmali.'
        : 'Dokumanda durum etiketiyle gorunur olmali.',
    status: entry.status,
  }));

  const gapRows = gapDecisions.slice(0, 6).map(gap => ({
    sourceSignal: gap.topic,
    decision: `gap_decision:${gap.decision}`,
    artifactTarget: gap.decision === 'assume_and_mark'
      ? 'BA Analiz varsayimlari ve Review acik konular'
      : gap.decision === 'verify_with_source'
        ? 'Review kaynak dogrulama matrisi'
        : 'Clarifying questions / blocking decision',
    validation: `impact=${gap.impact}; reversibility=${gap.reversibility}; question=${gap.question || '[YOK]'}`,
    status: gap.decision === 'assume_and_mark'
      ? 'VARSAYIM'
      : gap.decision === 'verify_with_source'
        ? 'ACIK_KONU'
        : 'CELISKI',
  } satisfies TraceabilityMatrixRow));

  return [...evidenceRows, ...gapRows].slice(0, 14);
}

export function buildCopilotCognitiveTrace(input: BuildCopilotCognitiveTraceInput): CopilotCognitiveTrace {
  const userSignals = buildUserSignals(input);
  const action = resolveAction(input, userSignals);
  const requiredAgents = selectAgents(input, action);
  const requiredTools = selectTools(input, action);
  const gapDecisions = buildGapDecisions(input);
  const evidenceLedger = buildEvidenceLedger(input);
  const finalDecision: FinalTurnDecision = {
    action,
    rationaleCodes: rationaleCodes(input, action),
    userExplanation: userExplanation(action),
    requiredAgents,
    requiredTools,
    outputPlan: input.cognitiveFrame.outputPlan,
    validationPlan: validationPlan(input, action),
  };

  return {
    statePath: buildStatePath(action),
    userSignals,
    confidence: buildConfidenceProfile(input),
    workingMemory: buildWorkingMemory(input),
    problemFrame: buildProblemFrameSnapshot(input.cognitiveFrame),
    evidenceLedger,
    gapDecisions,
    taskPlan: buildTaskPlan(input, requiredAgents, requiredTools, action, gapDecisions),
    toolExecutionPlan: buildToolExecutionPlan(requiredTools),
    artifactContract: buildArtifactContract(input),
    traceabilityMatrix: buildTraceabilityMatrix(evidenceLedger, gapDecisions),
    validationLoop: buildValidationLoop(input, gapDecisions, action),
    finalDecision,
  };
}

function renderKeyValueMap(values: Record<string, string | number | boolean>): string {
  return Object.entries(values)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
}

function renderList(items: string[], fallback: string): string {
  return items.length ? items.map(item => `- ${item}`).join('\n') : `- ${fallback}`;
}

function renderProblemFrameSnapshot(problem: ProblemFrameSnapshot): string {
  return [
    `- businessProblem: ${problem.businessProblem}`,
    `- desiredOutcome: ${problem.desiredOutcome}`,
    `- currentState: ${problem.currentState}`,
    `- targetState: ${problem.targetState}`,
    `- stakeholders: ${problem.stakeholders.join(' | ') || '[YOK]'}`,
    `- inScope: ${problem.inScope.join(' | ') || '[YOK]'}`,
    `- outOfScope: ${problem.outOfScope.join(' | ') || '[ACIK KONU]'}`,
    `- constraints: ${problem.constraints.join(' | ') || '[YOK]'}`,
    `- successMetrics: ${problem.successMetrics.join(' | ') || '[YOK]'}`,
  ].join('\n');
}

function renderEvidenceLedger(entries: EvidenceLedgerEntry[]): string {
  return entries.length
    ? entries.slice(0, 10).map(entry => (
      `- ${entry.id} ${entry.status}: ${entry.claim} | source=${entry.source} | confidence=${entry.confidence}/100 | usage=${entry.usage} | action=${entry.requiredAction}`
    )).join('\n')
    : '- Evidence ledger bos.';
}

function renderGapDecisions(decisions: GapDecision[]): string {
  return decisions.length
    ? decisions.slice(0, 10).map(item => (
      `- ${item.topic}: impact=${item.impact}, reversibility=${item.reversibility}, decision=${item.decision}; question=${item.question || '[YOK]'}; assumption=${item.assumption || '[YOK]'}`
    )).join('\n')
    : '- Kritik gap yok.';
}

function renderTaskPlan(tasks: AgentTaskPlanItem[]): string {
  return tasks.length
    ? tasks.map(task => (
      `- ${task.id} ${task.agent}: ${task.objective} Expected=${task.expectedOutput} EvidenceRule=${task.evidenceRule} Validation=${task.validationRule}`
    )).join('\n')
    : '- Agent task plan yok.';
}

function renderTraceabilityMatrix(rows: TraceabilityMatrixRow[]): string {
  return rows.length
    ? rows.slice(0, 10).map(row => (
      `- ${row.status}: source=${row.sourceSignal}; decision=${row.decision}; artifact=${row.artifactTarget}; validation=${row.validation}`
    )).join('\n')
    : '- Traceability matrix yok.';
}

function renderToolExecutionPlan(tools: ToolExecutionPlanItem[]): string {
  return tools.length
    ? tools.map(item => `- ${item.tool}: availability=${item.availability}; purpose=${item.purpose}; honesty=${item.honestyRule}`).join('\n')
    : '- Tool execution plan yok.';
}

function renderArtifactContract(contract: ArtifactContractSnapshot): string {
  return [
    `- mode: ${contract.mode}`,
    `- visibleSections: ${contract.visibleSections.join(', ')}`,
    '',
    'Must include:',
    renderList(contract.mustInclude.slice(0, 10), 'mustInclude yok'),
    '',
    'Source policy:',
    renderList(contract.sourcePolicy, 'source policy yok'),
    '',
    'Forbidden patterns:',
    renderList(contract.forbiddenPatterns, 'forbidden pattern yok'),
    '',
    'Quality gates:',
    renderList(contract.qualityGates, 'quality gate yok'),
  ].join('\n');
}

function renderValidationLoop(loop: ValidationLoopItem[]): string {
  return loop.length
    ? loop.map(item => `- ${item.stage}: ${item.check} FailureAction=${item.failureAction}`).join('\n')
    : '- Validation loop yok.';
}

export function buildCopilotCognitiveInstruction(trace: CopilotCognitiveTrace): string {
  return `
[COPILOT COGNITIVE ARCHITECTURE - ZORUNLU KARAR IZI]
Bu tur basit "soru sor / taslak uret" yonlendiricisi degildir. Asagidaki karar izini uygula.

State path:
${renderList(trace.statePath, 'state yok')}

UserSignals:
${renderKeyValueMap(trace.userSignals as unknown as Record<string, boolean>)}

FinalAction:
- action: ${trace.finalDecision.action}
- rationale: ${trace.finalDecision.rationaleCodes.join(' | ')}
- userExplanation: ${trace.finalDecision.userExplanation}

Required agents:
${renderList(trace.finalDecision.requiredAgents, 'orchestrator')}

Required tools:
${renderList(trace.finalDecision.requiredTools, 'tool gerekmedi')}

Tool execution plan:
${renderToolExecutionPlan(trace.toolExecutionPlan)}

ConfidenceProfile:
${renderKeyValueMap(trace.confidence as unknown as Record<string, number>)}

Working memory snapshot:
- confirmedFacts: ${trace.workingMemory.confirmedFacts.slice(0, 5).join(' | ') || '[YOK]'}
- assumptions: ${trace.workingMemory.assumptions.slice(0, 5).join(' | ') || '[YOK]'}
- openQuestions: ${trace.workingMemory.openQuestions.slice(0, 5).join(' | ') || '[YOK]'}
- userPreferences: ${trace.workingMemory.userPreferences.slice(0, 5).join(' | ') || '[YOK]'}
- unresolvedConflicts: ${trace.workingMemory.unresolvedConflicts.slice(0, 5).join(' | ') || '[YOK]'}

ProblemFrame:
${renderProblemFrameSnapshot(trace.problemFrame)}

Evidence ledger:
${renderEvidenceLedger(trace.evidenceLedger)}

Gap decision matrix:
${renderGapDecisions(trace.gapDecisions)}

Agent task plan:
${renderTaskPlan(trace.taskPlan)}

Traceability matrix:
${renderTraceabilityMatrix(trace.traceabilityMatrix)}

Artifact contract:
${renderArtifactContract(trace.artifactContract)}

Validation loop:
${renderValidationLoop(trace.validationLoop)}

Validation plan:
${renderList(trace.finalDecision.validationPlan, 'validation yok')}

Uygulama kurallari:
- Nihai aksiyon ask_blocking_questions degilse genel BA sorulariyla durma; dokuman/cevap uretirken varsayimlari gorunur yap.
- Nihai aksiyon ask_blocking_questions ise en fazla 3-5 kritik soru sor; her soru etki/geri donus maliyetine dayali olsun.
- Required agents listesindeki perspektifleri tek dokuman/cevapta birlestir; ayri sekme uretmeye zorlama.
- Required tools listesinde calistirmadigin araci calismis gibi sunma; sadece plan veya [DOGRULAMA GEREKIR] olarak yaz.
- Tool execution plan availability degeri external_host_required ise bu araci JetWork icinde calistirdigini iddia etme.
- ConfidenceProfile dusukse kesin hukum verme; Review'da dogrulanmadi/varsayim/acik konu ayrimini yap.
- Ciktiyi kalite kapisindan gecir: eksik coverage varsa Review'a repair notu ve hizli aksiyon ekle.
- Evidence ledger ve Gap decision matrix dokumanin Review bolumunde izlenebilir olmali.
- Traceability matrix kaynak sinyali -> karar -> dokuman hedefi -> dogrulama bagini gostermeli.
- Artifact contract mustInclude maddeleri businessAnalysis veya review icinde karsilanmali; karsilanmayanlari kalite dusus nedeni yap.
`.trim();
}

export function buildCopilotThinkingSummary(trace: CopilotCognitiveTrace): string {
  return [
    `Copilot karar izi: action=${trace.finalDecision.action}`,
    `agents=${trace.finalDecision.requiredAgents.join(',')}`,
    `tools=${trace.finalDecision.requiredTools.join(',')}`,
    `gaps=${trace.gapDecisions.map(item => item.decision).join(',') || 'none'}`,
    `evidence=${trace.evidenceLedger.map(item => item.status).join(',') || 'none'}`,
    `confidence intent/source/artifact=${trace.confidence.intentConfidence}/${trace.confidence.sourceConfidence}/${trace.confidence.artifactConfidence}`,
  ].join('; ');
}

const REVIEW_START = '<!-- COPILOT_COGNITIVE_TRACE_START -->';
const REVIEW_END = '<!-- COPILOT_COGNITIVE_TRACE_END -->';

function replaceMarkedBlock(currentContent: string, nextBlock: string): string {
  const escapedStart = REVIEW_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = REVIEW_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');
  if (blockRegex.test(currentContent || '')) return (currentContent || '').replace(blockRegex, nextBlock);
  return [currentContent?.trim(), nextBlock].filter(Boolean).join('\n\n');
}

function mdCell(value: string | number | undefined): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '/')
    .trim() || '[YOK]';
}

function reviewRows(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.map(mdCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(mdCell).join(' | ')} |`),
  ];
}

export function buildCopilotReviewMarkdown(trace: CopilotCognitiveTrace): string {
  const evidenceRows = trace.evidenceLedger.slice(0, 12).map(entry => [
    entry.id,
    entry.status,
    `${entry.confidence}/100`,
    entry.claim,
    entry.source,
    entry.usage,
    entry.requiredAction,
  ]);
  const gapRows = trace.gapDecisions.slice(0, 12).map(item => [
    item.topic,
    item.impact,
    item.reversibility,
    item.decision,
    item.question || '[YOK]',
    item.assumption || '[YOK]',
  ]);
  const taskRows = trace.taskPlan.map(task => [
    task.id,
    task.agent,
    task.objective,
    task.expectedOutput,
    task.validationRule,
  ]);
  const toolRows = trace.toolExecutionPlan.map(item => [
    item.tool,
    item.availability,
    item.purpose,
    item.honestyRule,
  ]);
  const traceabilityRows = trace.traceabilityMatrix.slice(0, 14).map(row => [
    row.status,
    row.sourceSignal,
    row.decision,
    row.artifactTarget,
    row.validation,
  ]);
  const validationRows = trace.validationLoop.map(item => [
    item.stage,
    item.check,
    item.failureAction,
  ]);

  return [
    REVIEW_START,
    '## Copilot Cognitive Decision Trace',
    '',
    '| Alan | Deger |',
    '| --- | --- |',
    `| Final Action | ${trace.finalDecision.action} |`,
    `| Rationale | ${trace.finalDecision.rationaleCodes.join(' / ')} |`,
    `| State Path | ${trace.statePath.join(' -> ')} |`,
    `| Agents | ${trace.finalDecision.requiredAgents.join(', ')} |`,
    `| Tools | ${trace.finalDecision.requiredTools.join(', ')} |`,
    `| Confidence | intent ${trace.confidence.intentConfidence}, source ${trace.confidence.sourceConfidence}, problem ${trace.confidence.problemFrameConfidence}, artifact ${trace.confidence.artifactConfidence}, validation ${trace.confidence.validationConfidence} |`,
    '',
    '### Karar Aciklamasi',
    trace.finalDecision.userExplanation,
    '',
    '### Working Memory Snapshot',
    '- Confirmed facts: ' + (trace.workingMemory.confirmedFacts.slice(0, 5).join(' | ') || '[YOK]'),
    '- Assumptions: ' + (trace.workingMemory.assumptions.slice(0, 5).join(' | ') || '[YOK]'),
    '- Open questions: ' + (trace.workingMemory.openQuestions.slice(0, 5).join(' | ') || '[YOK]'),
    '- Unresolved conflicts: ' + (trace.workingMemory.unresolvedConflicts.slice(0, 5).join(' | ') || '[YOK]'),
    '',
    '### ProblemFrame Snapshot',
    ...reviewRows(['Alan', 'Deger'], [
      ['Business problem', trace.problemFrame.businessProblem],
      ['Desired outcome', trace.problemFrame.desiredOutcome],
      ['Current state', trace.problemFrame.currentState],
      ['Target state', trace.problemFrame.targetState],
      ['Stakeholders', trace.problemFrame.stakeholders.join(' | ')],
      ['In scope', trace.problemFrame.inScope.join(' | ')],
      ['Constraints', trace.problemFrame.constraints.join(' | ')],
      ['Success metrics', trace.problemFrame.successMetrics.join(' | ')],
    ]),
    '',
    '### Evidence Ledger',
    ...(evidenceRows.length
      ? reviewRows(['Id', 'Durum', 'Guven', 'Iddia', 'Kaynak', 'Kullanim', 'Aksiyon'], evidenceRows)
      : ['- Evidence ledger bos.']),
    '',
    '### Gap Decision Matrix',
    ...(gapRows.length
      ? reviewRows(['Konu', 'Etki', 'Geri Donus', 'Karar', 'Soru', 'Varsayim'], gapRows)
      : ['- Kritik gap yok.']),
    '',
    '### Agent Task Plan',
    ...(taskRows.length
      ? reviewRows(['Task', 'Agent', 'Hedef', 'Beklenen Cikti', 'Dogrulama'], taskRows)
      : ['- Agent task plan yok.']),
    '',
    '### Tool Execution Plan',
    ...(toolRows.length
      ? reviewRows(['Tool', 'Availability', 'Amac', 'Durustluk Kurali'], toolRows)
      : ['- Tool execution plan yok.']),
    '',
    '### Traceability Matrix',
    ...(traceabilityRows.length
      ? reviewRows(['Durum', 'Kaynak Sinyali', 'Karar', 'Dokuman Hedefi', 'Dogrulama'], traceabilityRows)
      : ['- Traceability matrix yok.']),
    '',
    '### Artifact Contract',
    ...reviewRows(['Alan', 'Deger'], [
      ['Mode', trace.artifactContract.mode],
      ['Visible sections', trace.artifactContract.visibleSections.join(' | ')],
      ['Must include', trace.artifactContract.mustInclude.join(' | ')],
      ['Source policy', trace.artifactContract.sourcePolicy.join(' | ')],
      ['Forbidden patterns', trace.artifactContract.forbiddenPatterns.join(' | ')],
      ['Quality gates', trace.artifactContract.qualityGates.join(' | ')],
    ]),
    '',
    '### Validation Loop',
    ...(validationRows.length
      ? reviewRows(['Stage', 'Check', 'Failure Action'], validationRows)
      : ['- Validation loop yok.']),
    '',
    '### Validation Plan',
    ...trace.finalDecision.validationPlan.map(item => `- ${item}`),
    REVIEW_END,
  ].join('\n');
}

export function attachCopilotTraceToDocument(
  document: DocumentData | null | undefined,
  trace: CopilotCognitiveTrace,
): DocumentData | null | undefined {
  if (!document) return document;
  const currentReview = document.review || { content: '', status: 'DRAFT' as const, flags: [] };
  return {
    ...document,
    review: {
      ...currentReview,
      content: replaceMarkedBlock(currentReview.content || '', buildCopilotReviewMarkdown(trace)),
      flags: Array.from(new Set([...(currentReview.flags || []), 'COPILOT_COGNITIVE_TRACE'])),
    },
  };
}
