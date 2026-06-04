export type RequirementCategory =
  | 'BR'
  | 'FR'
  | 'NFR'
  | 'UI'
  | 'INT'
  | 'DOC'
  | 'RPT'
  | 'SEC'
  | 'PERF';

export type RequirementPriority = 'Must' | 'Should' | 'Could' | 'Won\'t';
export type RequirementStatus = 'Draft' | 'Reviewed' | 'Approved' | 'Needs Clarification';
export type QualitySeverity = 'blocking' | 'warning' | 'info';
export type FlowStepType = 'start' | 'activity' | 'decision' | 'system' | 'integration' | 'notification' | 'end';
export type UiMessageType = 'success' | 'error' | 'warning' | 'info' | 'inline-validation' | 'modal' | 'banner';
export type TriggerType = 'manual' | 'system' | 'integration' | 'schedule' | 'workflow-condition';

export interface DocumentMetadata {
  documentTitle: string;
  projectName: string;
  requestNo?: string;
  version: string;
  date: string;
  confidentiality?: string;
  preparedBy?: string;
  sourceSummary?: string;
}

export interface ProjectIdentityCard {
  projectName: string;
  customerName?: string;
  projectManager?: string;
  scopeManager?: string;
  businessApplicationOwner?: string;
}

export interface Participant {
  role: string;
  name: string;
  department?: string;
  responsibility?: string;
}

export interface RevisionHistoryRow {
  date: string;
  version: string;
  description: string;
  author: string;
}

export interface Requirement {
  id: string;
  category: RequirementCategory;
  title: string;
  statement: string;
  rationale?: string;
  priority: RequirementPriority;
  source?: string;
  ownerRole?: string;
  acceptanceCriteria: string[];
  relatedProcessIds: string[];
  status: RequirementStatus;
}

export interface KpiDefinition {
  id: string;
  name: string;
  description: string;
  formula?: string;
  unit?: string;
  target?: string;
  dataSource?: string;
  relatedProcessIds: string[];
}

export interface FlowStep {
  id: string;
  order: number;
  type: FlowStepType;
  actor: string;
  title: string;
  description: string;
  entryCondition?: string;
  exitCondition?: string;
  nextStepIds: string[];
}

export interface UiMessage {
  id: string;
  screen: string;
  trigger: string;
  type: UiMessageType;
  title?: string;
  message: string;
  userAction?: string;
  blocking: boolean;
  relatedRequirementIds: string[];
}

export interface DocumentRule {
  id: string;
  documentName: string;
  documentType: string;
  required: boolean;
  allowedExtensions: string[];
  ownerRole?: string;
  retentionTarget?: string;
  integrationTarget?: string;
  completionImpact?: string;
}

export interface IntegrationReference {
  id: string;
  system: string;
  direction: 'inbound' | 'outbound' | 'bidirectional';
  trigger: TriggerType;
  payloadSummary?: string;
  successBehavior?: string;
  errorBehavior?: string;
}

export interface ScreenshotReference {
  id: string;
  title: string;
  sourceName?: string;
  description?: string;
  relatedSection?: string;
}

export interface ProcessModel {
  id: string;
  code?: string;
  title: string;
  purpose: string;
  highLevelDescription: string;
  businessRules: string[];
  businessRequirements: Requirement[];
  kpis: KpiDefinition[];
  flowSteps: FlowStep[];
  uiMessages: UiMessage[];
  documentRules: DocumentRule[];
  integrations: IntegrationReference[];
  screenshots: ScreenshotReference[];
  bpmnXml?: string;
  openQuestions: string[];
}

export interface CommonUiRules {
  designPrinciples: string[];
  validationRules: UiMessage[];
  toastRules: UiMessage[];
  modalRules: UiMessage[];
  emptyStateRules: UiMessage[];
}

export interface IntegrationDefinition {
  id: string;
  system: string;
  purpose: string;
  owner?: string;
  interfaceType?: string;
  dataObjects: string[];
  errorHandling: string[];
  auditLogRules: string[];
}

export interface DocumentManagementDefinition {
  purpose: string;
  storageSystem?: string;
  documentRules: DocumentRule[];
  versioningRules: string[];
  authorizationRules: string[];
  auditRules: string[];
}

export interface NotificationDefinition {
  id: string;
  trigger: string;
  channel: 'in-app' | 'email' | 'both';
  recipientRule: string;
  messageSummary: string;
  escalationRule?: string;
}

export interface NotificationManagementDefinition {
  purpose: string;
  notifications: NotificationDefinition[];
  readTrackingRequired: boolean;
  reminderRules: string[];
}

export interface NonFunctionalRequirement {
  id: string;
  category: 'security' | 'performance' | 'availability' | 'audit' | 'usability' | 'integration' | 'data-retention';
  statement: string;
  measurableCriteria?: string;
  priority: RequirementPriority;
}

export interface QualityIssue {
  id: string;
  severity: QualitySeverity;
  section: string;
  message: string;
  recommendation?: string;
}

export interface DocumentQualityReport {
  score: number;
  summary: string;
  blockingIssues: QualityIssue[];
  warnings: QualityIssue[];
  infos: QualityIssue[];
  missingSections: string[];
  duplicateRequirementIds: string[];
  missingTraceability: string[];
}

export interface ConceptualDesignDocument {
  metadata: DocumentMetadata;
  projectIdentity: ProjectIdentityCard;
  participants: Participant[];
  revisionHistory: RevisionHistoryRow[];
  executiveSummary: string;
  glossary: { term: string; definition: string }[];
  processModels: ProcessModel[];
  commonUiRules: CommonUiRules;
  integrations: IntegrationDefinition[];
  documentManagement: DocumentManagementDefinition;
  notificationManagement: NotificationManagementDefinition;
  nonFunctionalRequirements: NonFunctionalRequirement[];
  appendices: { id: string; title: string; content: string }[];
  qualityReport?: DocumentQualityReport;
}

export interface AnalysisInputAttachment {
  name?: string;
  mimeType: string;
  data: string;
}

export interface GenerateConceptualDesignInput {
  projectName?: string;
  requestNo?: string;
  notes: string;
  conversationSummary?: string;
  templateGuidance?: string;
  attachments?: AnalysisInputAttachment[];
  model?: string;
}

export interface GenerateConceptualDesignResult {
  document: ConceptualDesignDocument;
  rawResponse: string;
  qualityReport: DocumentQualityReport;
}
