import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const RequirementCategorySchema = z.enum(['BR', 'FR', 'NFR', 'UI', 'INT', 'DOC', 'RPT', 'SEC', 'PERF']);
export const RequirementPrioritySchema = z.enum(['Must', 'Should', 'Could', "Won't"]);
export const RequirementStatusSchema = z.enum(['Draft', 'Reviewed', 'Approved', 'Needs Clarification']);
export const QualitySeveritySchema = z.enum(['blocking', 'warning', 'info']);
export const FlowStepTypeSchema = z.enum(['start', 'activity', 'decision', 'system', 'integration', 'notification', 'end']);
export const UiMessageTypeSchema = z.enum(['success', 'error', 'warning', 'info', 'inline-validation', 'modal', 'banner']);
export const TriggerTypeSchema = z.enum(['manual', 'system', 'integration', 'schedule', 'workflow-condition']);

const nonEmptyString = z.string().trim().min(1);
const optionalText = z.string().trim().optional();

export const DocumentMetadataSchema = z.object({
  documentTitle: nonEmptyString,
  projectName: nonEmptyString,
  requestNo: optionalText,
  version: nonEmptyString,
  date: nonEmptyString,
  confidentiality: optionalText,
  preparedBy: optionalText,
  sourceSummary: optionalText,
});

export const ProjectIdentityCardSchema = z.object({
  projectName: nonEmptyString,
  customerName: optionalText,
  projectManager: optionalText,
  scopeManager: optionalText,
  businessApplicationOwner: optionalText,
});

export const ParticipantSchema = z.object({
  role: nonEmptyString,
  name: nonEmptyString,
  department: optionalText,
  responsibility: optionalText,
});

export const RevisionHistoryRowSchema = z.object({
  date: nonEmptyString,
  version: nonEmptyString,
  description: nonEmptyString,
  author: nonEmptyString,
});

export const RequirementSchema = z.object({
  id: nonEmptyString,
  category: RequirementCategorySchema,
  title: nonEmptyString,
  statement: nonEmptyString,
  rationale: optionalText,
  priority: RequirementPrioritySchema,
  source: optionalText,
  ownerRole: optionalText,
  acceptanceCriteria: z.array(nonEmptyString).default([]),
  relatedProcessIds: z.array(nonEmptyString).default([]),
  status: RequirementStatusSchema.default('Draft'),
});

export const KpiDefinitionSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  description: nonEmptyString,
  formula: optionalText,
  unit: optionalText,
  target: optionalText,
  dataSource: optionalText,
  relatedProcessIds: z.array(nonEmptyString).default([]),
});

export const FlowStepSchema = z.object({
  id: nonEmptyString,
  order: z.number().int().nonnegative(),
  type: FlowStepTypeSchema,
  actor: nonEmptyString,
  title: nonEmptyString,
  description: nonEmptyString,
  entryCondition: optionalText,
  exitCondition: optionalText,
  nextStepIds: z.array(nonEmptyString).default([]),
});

export const UiMessageSchema = z.object({
  id: nonEmptyString,
  screen: nonEmptyString,
  trigger: nonEmptyString,
  type: UiMessageTypeSchema,
  title: optionalText,
  message: nonEmptyString,
  userAction: optionalText,
  blocking: z.boolean().default(false),
  relatedRequirementIds: z.array(nonEmptyString).default([]),
});

export const DocumentRuleSchema = z.object({
  id: nonEmptyString,
  documentName: nonEmptyString,
  documentType: nonEmptyString,
  required: z.boolean(),
  allowedExtensions: z.array(nonEmptyString).default([]),
  ownerRole: optionalText,
  retentionTarget: optionalText,
  integrationTarget: optionalText,
  completionImpact: optionalText,
});

export const IntegrationReferenceSchema = z.object({
  id: nonEmptyString,
  system: nonEmptyString,
  direction: z.enum(['inbound', 'outbound', 'bidirectional']),
  trigger: TriggerTypeSchema,
  payloadSummary: optionalText,
  successBehavior: optionalText,
  errorBehavior: optionalText,
});

export const ScreenshotReferenceSchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  sourceName: optionalText,
  description: optionalText,
  relatedSection: optionalText,
});

export const ProcessModelSchema = z.object({
  id: nonEmptyString,
  code: optionalText,
  title: nonEmptyString,
  purpose: nonEmptyString,
  highLevelDescription: nonEmptyString,
  businessRules: z.array(nonEmptyString).default([]),
  businessRequirements: z.array(RequirementSchema).default([]),
  kpis: z.array(KpiDefinitionSchema).default([]),
  flowSteps: z.array(FlowStepSchema).default([]),
  uiMessages: z.array(UiMessageSchema).default([]),
  documentRules: z.array(DocumentRuleSchema).default([]),
  integrations: z.array(IntegrationReferenceSchema).default([]),
  screenshots: z.array(ScreenshotReferenceSchema).default([]),
  bpmnXml: optionalText,
  openQuestions: z.array(nonEmptyString).default([]),
});

export const CommonUiRulesSchema = z.object({
  designPrinciples: z.array(nonEmptyString).default([]),
  validationRules: z.array(UiMessageSchema).default([]),
  toastRules: z.array(UiMessageSchema).default([]),
  modalRules: z.array(UiMessageSchema).default([]),
  emptyStateRules: z.array(UiMessageSchema).default([]),
});

export const IntegrationDefinitionSchema = z.object({
  id: nonEmptyString,
  system: nonEmptyString,
  purpose: nonEmptyString,
  owner: optionalText,
  interfaceType: optionalText,
  dataObjects: z.array(nonEmptyString).default([]),
  errorHandling: z.array(nonEmptyString).default([]),
  auditLogRules: z.array(nonEmptyString).default([]),
});

export const DocumentManagementDefinitionSchema = z.object({
  purpose: nonEmptyString,
  storageSystem: optionalText,
  documentRules: z.array(DocumentRuleSchema).default([]),
  versioningRules: z.array(nonEmptyString).default([]),
  authorizationRules: z.array(nonEmptyString).default([]),
  auditRules: z.array(nonEmptyString).default([]),
});

export const NotificationDefinitionSchema = z.object({
  id: nonEmptyString,
  trigger: nonEmptyString,
  channel: z.enum(['in-app', 'email', 'both']),
  recipientRule: nonEmptyString,
  messageSummary: nonEmptyString,
  escalationRule: optionalText,
});

export const NotificationManagementDefinitionSchema = z.object({
  purpose: nonEmptyString,
  notifications: z.array(NotificationDefinitionSchema).default([]),
  readTrackingRequired: z.boolean().default(true),
  reminderRules: z.array(nonEmptyString).default([]),
});

export const NonFunctionalRequirementSchema = z.object({
  id: nonEmptyString,
  category: z.enum(['security', 'performance', 'availability', 'audit', 'usability', 'integration', 'data-retention']),
  statement: nonEmptyString,
  measurableCriteria: optionalText,
  priority: RequirementPrioritySchema,
});

export const QualityIssueSchema = z.object({
  id: nonEmptyString,
  severity: QualitySeveritySchema,
  section: nonEmptyString,
  message: nonEmptyString,
  recommendation: optionalText,
});

export const DocumentQualityReportSchema = z.object({
  score: z.number().min(0).max(100),
  summary: nonEmptyString,
  blockingIssues: z.array(QualityIssueSchema).default([]),
  warnings: z.array(QualityIssueSchema).default([]),
  infos: z.array(QualityIssueSchema).default([]),
  missingSections: z.array(nonEmptyString).default([]),
  duplicateRequirementIds: z.array(nonEmptyString).default([]),
  missingTraceability: z.array(nonEmptyString).default([]),
});

export const ConceptualDesignDocumentSchema = z.object({
  metadata: DocumentMetadataSchema,
  projectIdentity: ProjectIdentityCardSchema,
  participants: z.array(ParticipantSchema).default([]),
  revisionHistory: z.array(RevisionHistoryRowSchema).default([]),
  executiveSummary: nonEmptyString,
  glossary: z.array(z.object({ term: nonEmptyString, definition: nonEmptyString })).default([]),
  processModels: z.array(ProcessModelSchema).default([]),
  commonUiRules: CommonUiRulesSchema,
  integrations: z.array(IntegrationDefinitionSchema).default([]),
  documentManagement: DocumentManagementDefinitionSchema,
  notificationManagement: NotificationManagementDefinitionSchema,
  nonFunctionalRequirements: z.array(NonFunctionalRequirementSchema).default([]),
  appendices: z.array(z.object({ id: nonEmptyString, title: nonEmptyString, content: nonEmptyString })).default([]),
  qualityReport: DocumentQualityReportSchema.optional(),
});

export const conceptualDesignJsonSchema = zodToJsonSchema(
  ConceptualDesignDocumentSchema,
  'ConceptualDesignDocument',
);

export type ConceptualDesignDocumentInput = z.infer<typeof ConceptualDesignDocumentSchema>;
