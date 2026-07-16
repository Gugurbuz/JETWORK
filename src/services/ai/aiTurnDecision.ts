import type { DocumentData } from '../../types';
import type { SourceIntelligenceReport } from '../sourceIntelligence';
import type { ArtifactMode, BaCognitiveFrame } from './baCognitiveFrame';
import type { BehaviorDecision } from './behaviorDecision';
import type { DocumentOperation, DocumentSectionKey, IntentClassification } from './intentTypes';
import {
  ARTIFACT_PROFILES,
  renderArtifactProfileInstruction,
  selectArtifactProfile,
  type ArtifactProfile,
  type ArtifactProfileId,
} from './artifactProfiles';

export type AiTurnAction =
  | 'system_message'
  | 'answer_only'
  | 'ask_questions'
  | 'research_first'
  | 'draft_document'
  | 'revise_document'
  | 'validate_document'
  | 'repair_document'
  | 'preview_change'
  | 'execute_confirmed_change'
  | 'cancel_pending_change'
  | 'pending_operation_missing'
  | 'update_selected_text'
  | 'memory_action'
  | 'workflow_action';

export type AiQuestionType = 'none' | 'critical_only' | 'domain_discovery';

export interface AiTurnDecision {
  action: AiTurnAction;
  artifactMode: ArtifactMode | 'none';
  artifactProfile: ArtifactProfile;
  sourcePolicy: {
    requiresExternalResearch: boolean;
    officialSourceRequired: boolean;
    canClaimVerified: boolean;
    sourceSensitive: boolean;
  };
  questionPolicy: {
    shouldAsk: boolean;
    reason: string;
    maxQuestions: number;
    questionType: AiQuestionType;
  };
  documentPolicy: {
    shouldUpdateDocument: boolean;
    templateProfile: ArtifactProfileId;
    allowAssumptions: boolean;
    allowAutoRepair: boolean;
    allowTemplateNormalization: boolean;
    forceDocumentGeneration: boolean;
    visibleSections: Array<'businessAnalysis' | 'review'>;
  };
  executionPolicy: {
    operation: DocumentOperation;
    targetSection: DocumentSectionKey | null;
    requiresConfirmation: boolean;
  };
  qualityPolicy: {
    minimumAcceptableScore: number;
    blockOnContextLeakage: boolean;
    validationOnlyByDefault: boolean;
  };
  confidence: number;
  reason: string;
  trace: string[];
}

export interface BuildAiTurnDecisionInput {
  userMessage: string;
  document: DocumentData | null;
  classification: IntentClassification;
  behaviorDecision: BehaviorDecision;
  cognitiveFrame: BaCognitiveFrame;
  sourceReport: SourceIntelligenceReport;
  discoverySignals: {
    mustGenerateNow?: boolean;
    greetingOnly?: boolean;
    newStandaloneRequest?: boolean;
    reason?: string;
  };
  hasSelectedText?: boolean;
  capabilities?: {
    zeroTouchEnabled?: boolean;
  };
  pendingOperation?: {
    id: string;
  } | null;
  pendingOperationLookupPerformed?: boolean;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

function normalize(value = ''): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function documentHasContent(document: DocumentData | null): boolean {
  if (!document) return false;
  return Object.values(document as any).some((section: any) => (
    section?.content && String(section.content).trim().length > 0
  ));
}

function explicitDocumentGeneration(text: string): boolean {
  const normalized = normalize(text);
  return /\b(kavramsal|tasarim|dokuman|rapor|brd|fdd|ba analiz|is analiz|hazirla|olustur|uret|yaz|taslak|cikar|word format)\b/.test(normalized);
}

function explicitResearchRequest(text: string): boolean {
  const normalized = normalize(text);
  return /\b(arastir|kaynak|resmi kaynak|guncel|best practice|mevzuat|api dokuman|dogrula)\b/.test(normalized);
}

function assumptionConsent(text: string): boolean {
  const normalized = normalize(text);
  return /\b(varsayim|varsayimlarla|bu bilgilerle|mevcut bilgilerle|soru sorma|daha fazla soru sorma|hizli taslak|ilk taslak|sen yap|devam et|durma|uygula)\b/.test(normalized);
}

function explicitRepairRequest(text: string): boolean {
  const normalized = normalize(text);
  return /\b(eksikleri tamamla|word format|sablon uyum|review.*kapat|acik konulari kapat|kalite.*duzelt|revizyon.*tamamla|onar|iyilestir|derinlestir|coverage.*tamamla|traceability.*tamamla)\b/.test(normalized);
}

function pendingConfirmation(text: string): boolean {
  const normalized = normalize(text);
  return /^(devam et|uygula|onayla|onayliyorum|evet uygula|degisikligi uygula)$/.test(normalized);
}

function pendingCancellation(text: string): boolean {
  const normalized = normalize(text);
  return /^(iptal|vazgec|vazgectim|islemi iptal et|degisikligi iptal et)$/.test(normalized);
}

function sourceSensitive(input: BuildAiTurnDecisionInput): boolean {
  const text = normalize([
    input.userMessage,
    input.sourceReport.domainHints.join(' '),
    input.sourceReport.systems.join(' '),
    input.sourceReport.integrations.join(' '),
  ].join(' '));

  return /\b(kkb|findeks|kredi notu|muvafakat|kvkk|finansal veri|kisisel veri|mevzuat|kanun|api|oauth|sap|iys|entegrasyon|resmi kurum)\b/.test(text);
}

function officialSourceRequired(input: BuildAiTurnDecisionInput): boolean {
  const text = normalize([
    input.userMessage,
    input.sourceReport.domainHints.join(' '),
    input.sourceReport.integrations.join(' '),
  ].join(' '));

  return /\b(kkb|findeks|kredi notu|muvafakat|kvkk|finansal veri|mevzuat|kanun|iys|api dokuman|resmi kaynak)\b/.test(text)
    || input.sourceReport.domainHints.some(hint => ['iys', 'sap'].includes(hint))
    || input.sourceReport.integrations.some(item => /\b(api|oauth|mevzuat|kanun|dis|resmi)\b/i.test(item));
}

function hasOfficialEvidence(input: BuildAiTurnDecisionInput): boolean {
  const text = [
    input.userMessage,
    (input.sourceReport.openTopics || []).join(' '),
    (input.sourceReport.integrations || []).join(' '),
  ].join(' ');
  return /https?:\/\//i.test(text)
    || /iys\.org\.tr|ahsdocs\.iys\.org\.tr|mevzuat\.gov\.tr|ticaret\.gov\.tr|help\.sap\.com|sap\.com|findeks\.com|kkb\.com/i.test(text);
}

function sparseHighImpactBrief(input: BuildAiTurnDecisionInput): boolean {
  const text = normalize(input.userMessage);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const highImpact = /\b(kkb|findeks|kredi notu|muvafakat|kvkk|finansal veri|sap|crm|entegrasyon|api|ai|bot|asistan|d2d|mobil)\b/.test(text);
  return highImpact && !explicitDocumentGeneration(input.userMessage) && wordCount <= 18 && !documentHasContent(input.document);
}

function wantsCorporateTemplate(input: BuildAiTurnDecisionInput): boolean {
  const text = normalize(input.userMessage);
  return /\b(kavramsal|word|tasarim dokumani|fdd|brd|surec modeli|onay tablosu|dokuman tarihcesi)\b/.test(text);
}

function resolveArtifactMode(input: BuildAiTurnDecisionInput): ArtifactMode | 'none' {
  if (input.classification.baAgentFocus === 'test') return 'test_scenario';
  if (input.classification.baAgentFocus === 'technical_analysis') return 'technical_analysis';
  if (input.classification.baAgentFocus === 'flow') return 'process_design';
  if (input.classification.subIntent === 'generate_api_contract') return 'api_specification';
  if (input.classification.subIntent === 'generate_review_report' || input.classification.primaryIntent === 'quality_review') return 'conceptual_analysis';
  if (input.classification.documentImpact === 'updates_document' || explicitDocumentGeneration(input.userMessage)) {
    return input.cognitiveFrame.artifactMode || 'conceptual_analysis';
  }
  return input.cognitiveFrame.artifactMode === 'conceptual_analysis' ? 'none' : input.cognitiveFrame.artifactMode;
}

function selectAction(input: BuildAiTurnDecisionInput): AiTurnAction {
  const hasDocument = documentHasContent(input.document);
  const allowsAssumption = assumptionConsent(input.userMessage) || !!input.discoverySignals.mustGenerateNow;
  const explicitDoc = explicitDocumentGeneration(input.userMessage);
  const sensitive = sourceSensitive(input);
  const officialRequired = officialSourceRequired(input);
  const repairRequest = explicitRepairRequest(input.userMessage);

  if (input.pendingOperationLookupPerformed && pendingCancellation(input.userMessage)) {
    return input.pendingOperation ? 'cancel_pending_change' : 'pending_operation_missing';
  }
  if (input.pendingOperationLookupPerformed && pendingConfirmation(input.userMessage)) {
    return input.pendingOperation ? 'execute_confirmed_change' : 'pending_operation_missing';
  }
  if (input.discoverySignals.greetingOnly) return 'answer_only';
  if (input.classification.subIntent === 'zero_touch_requested' && !input.capabilities?.zeroTouchEnabled) return 'system_message';
  if (['agent_debate_requested', 'unsupported_request', 'invalid_command'].includes(input.classification.subIntent)) return 'system_message';
  if (
    input.classification.subIntent === 'missing_selection'
    || input.classification.documentImpact === 'updates_selected_text' && !input.hasSelectedText
  ) return 'ask_questions';
  if (input.classification.requiresClarification && !allowsAssumption) return 'ask_questions';
  if (
    input.classification.riskLevel === 'high'
    || input.classification.documentImpact === 'requires_user_confirmation'
    || input.classification.requiresPreview
  ) return 'preview_change';
  if (input.classification.primaryIntent === 'memory_decision' || input.classification.documentImpact === 'updates_memory_only') return 'memory_action';
  if (input.classification.primaryIntent === 'workflow' || input.classification.documentImpact === 'workflow_action_only') return 'workflow_action';
  if (input.classification.primaryIntent === 'selected_text_editing' || input.classification.documentImpact === 'updates_selected_text') return 'update_selected_text';
  if (hasDocument && repairRequest) return 'repair_document';
  if (input.classification.primaryIntent === 'quality_review') return input.classification.subIntent === 'score_document' ? 'validate_document' : 'validate_document';
  if (explicitResearchRequest(input.userMessage) && !explicitDoc) return 'research_first';
  if (sparseHighImpactBrief(input) && !allowsAssumption) return 'ask_questions';
  if ((input.cognitiveFrame.action === 'block_until_source' || input.cognitiveFrame.action === 'ask_first') && !allowsAssumption) return 'ask_questions';
  if (input.behaviorDecision.mode === 'ask_clarifying_questions' && !allowsAssumption) return 'ask_questions';
  if (input.classification.documentImpact === 'updates_document' || input.behaviorDecision.shouldUpdateDocument || explicitDoc || allowsAssumption) {
    return hasDocument ? 'revise_document' : 'draft_document';
  }
  if (input.behaviorDecision.mode === 'chat_only') return 'answer_only';
  if (officialRequired && sensitive && !explicitDoc) return 'ask_questions';
  return 'answer_only';
}

export function buildAiTurnDecision(input: BuildAiTurnDecisionInput): AiTurnDecision {
  const action = selectAction(input);
  const documentActions: AiTurnAction[] = ['draft_document', 'revise_document', 'validate_document', 'repair_document', 'execute_confirmed_change'];
  const mode = !documentActions.includes(action)
    ? 'none'
    : resolveArtifactMode(input);
  const profile = action === 'ask_questions'
    ? ARTIFACT_PROFILES.discovery_brief
    : !documentActions.includes(action)
      ? ARTIFACT_PROFILES.none
      : selectArtifactProfile({
        artifactMode: mode === 'none' ? undefined : mode,
        focus: input.classification.baAgentFocus,
        wantsCorporateTemplate: wantsCorporateTemplate(input),
        sourceHasProcesses: input.sourceReport.processes.length > 0,
      });

  const sensitive = sourceSensitive(input);
  const officialRequired = officialSourceRequired(input);
  const allowAssumptions = assumptionConsent(input.userMessage)
    || !!input.discoverySignals.mustGenerateNow
    || action === 'draft_document'
    || action === 'revise_document';
  const shouldUpdateDocument = ['draft_document', 'revise_document', 'repair_document', 'execute_confirmed_change'].includes(action);
  const forceDocumentGeneration = ['draft_document', 'revise_document', 'repair_document'].includes(action);
  const allowAutoRepair = action === 'repair_document';
  const allowTemplateNormalization = shouldUpdateDocument && profile.id !== 'none' && profile.id !== 'discovery_brief';
  const canClaimVerified = !officialRequired || hasOfficialEvidence(input);
  const highImpactGaps = input.cognitiveFrame.informationGaps
    .filter(gap => gap.impact === 'blocking' || gap.impact === 'high')
    .length;

  const trace = [
    `action:${action}`,
    `artifact:${mode}`,
    `profile:${profile.id}`,
    `behavior:${input.behaviorDecision.mode}`,
    `cognitive:${input.cognitiveFrame.action}`,
    `sourceSensitive:${sensitive}`,
    `officialSourceRequired:${officialRequired}`,
    input.discoverySignals.reason ? `signal:${input.discoverySignals.reason}` : '',
  ].filter(Boolean);

  return {
    action,
    artifactMode: mode,
    artifactProfile: profile,
    sourcePolicy: {
      requiresExternalResearch: input.behaviorDecision.shouldUseResearch || input.classification.requiresResearch || officialRequired,
      officialSourceRequired: officialRequired,
      canClaimVerified,
      sourceSensitive: sensitive,
    },
    questionPolicy: {
      shouldAsk: action === 'ask_questions',
      reason: action === 'ask_questions'
        ? 'Yuksek etkili veya kaynak gerektiren kararlar netlesmeden tam dokuman uretimi yanlis yonlendirebilir.'
        : 'Bu turda soru sorma ana aksiyon degil.',
      maxQuestions: action === 'ask_questions' ? Math.min(4, Math.max(2, input.behaviorDecision.questionBudget || 3)) : 0,
      questionType: action === 'ask_questions'
        ? input.behaviorDecision.domain !== 'generic_ba' ? 'domain_discovery' : 'critical_only'
        : 'none',
    },
    documentPolicy: {
      shouldUpdateDocument,
      templateProfile: profile.id,
      allowAssumptions,
      allowAutoRepair,
      allowTemplateNormalization,
      forceDocumentGeneration,
      visibleSections: ['businessAnalysis', 'review'],
    },
    executionPolicy: {
      operation: input.classification.operation,
      targetSection: input.classification.targetSection || null,
      requiresConfirmation: action === 'preview_change',
    },
    qualityPolicy: {
      minimumAcceptableScore: officialRequired ? 72 : 78,
      blockOnContextLeakage: true,
      validationOnlyByDefault: !allowAutoRepair,
    },
    confidence: clamp(
      (input.classification.confidence || 0.5) * 45
      + input.cognitiveFrame.confidence * 0.35
      + input.sourceReport.confidence * 0.2
      - highImpactGaps * 4,
    ),
    reason: trace.join('; '),
    trace,
  };
}

export function buildAiTurnDecisionInstruction(decision: AiTurnDecision): string {
  return [
    '[AI TURN DECISION - ANA KARAR SOZLESMESI]',
    `- Final aksiyon: ${decision.action}`,
    `- Artifact modu: ${decision.artifactMode}`,
    `- Artifact profili: ${decision.artifactProfile.id}`,
    `- Dokuman guncelle: ${decision.documentPolicy.shouldUpdateDocument ? 'evet' : 'hayir'}`,
    `- Islem: ${decision.executionPolicy.operation}`,
    `- Hedef bolum: ${decision.executionPolicy.targetSection || 'yok'}`,
    `- Onay gerekli: ${decision.executionPolicy.requiresConfirmation ? 'evet' : 'hayir'}`,
    `- Soru sor: ${decision.questionPolicy.shouldAsk ? 'evet' : 'hayir'} (${decision.questionPolicy.questionType})`,
    `- Varsayim kullan: ${decision.documentPolicy.allowAssumptions ? 'evet, etiketli' : 'hayir'}`,
    `- Resmi kaynak gerekli: ${decision.sourcePolicy.officialSourceRequired ? 'evet' : 'hayir'}`,
    `- DOGRULANDI iddiasi kurulabilir mi: ${decision.sourcePolicy.canClaimVerified ? 'evet' : 'hayir'}`,
    `- Otomatik repair: ${decision.documentPolicy.allowAutoRepair ? 'evet' : 'hayir, validate-only'}`,
    `- Karar gerekcesi: ${decision.reason}`,
    '',
    renderArtifactProfileInstruction(decision.artifactProfile),
    '',
    'Uygulama:',
    '- Bu karar sozlesmesi ust karar olarak kabul edilir; alt promptlar buna ters davranamaz.',
    '- action=ask_questions ise document alani uretme.',
    '- action=answer_only, research_first, validate_document, memory_action, workflow_action, preview_change, pending_operation_missing veya cancel_pending_change ise dokumani guncelledim iddiasi kurma.',
    '- action=draft_document/revise_document ise document.businessAnalysis ve review alanlarini secili profile gore uret.',
    '- Kaynak gerektiren konularda arastirma/grounding yoksa DOGRULANDI yerine VARSAYIM veya ACIK KONU kullan.',
  ].join('\n');
}
