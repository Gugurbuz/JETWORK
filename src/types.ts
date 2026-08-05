export type MessageRole = 'user' | 'model';

export interface PromptSettings {
  systemInstruction: string;
  negativeConstraints: string;
  cotInstruction: string;
  totInstruction: string;
  reasoningFramework: 'standard' | 'cot' | 'tot';
  rolePersonas: Record<string, string>;
  fewShotLibrary: Record<string, string>;
  /** @deprecated Sprint 1 uses contextTokenBudget; retained for stored settings compatibility. */
  contextWindowSize?: number;
  contextTokenBudget?: number;
  memoryEnabled: boolean;
  versions?: PromptVersion[];
}

export interface PromptVersion extends PromptSettings {
  id: string;
  createdAt: number;
  versionNote: string;
}

export interface KnowledgeItem {
  id: string;
  content: string;
  keywords: string[];
  importance: number;
  createdAt: number;
  sourceType?: 'user_message' | 'conversation_summary' | 'uploaded_source' | 'manual';
  sourceMessageId?: string;
  similarity?: number;
  projectId: string;
}

export interface Reaction {
  emoji: string;
  users: string[];
}

export interface Question {
  id: string;
  text: string;
  options: string[];
}

export type AttachmentPurpose = 'chat_only' | 'knowledge_bank';

export interface AttachmentIngestion {
  status: 'queued' | 'uploading' | 'processing' | 'ready' | 'failed';
  sourceId?: string;
  jobId?: string;
  publicationStatus?: 'draft' | 'published' | 'archived';
  objectCount?: number;
  relationCount?: number;
  error?: string;
}

export interface MessageAttachment {
  attachmentId?: string;
  url: string;
  data?: string;
  mimeType: string;
  name?: string;
  file?: File;
  purpose?: AttachmentPurpose;
  ingestion?: AttachmentIngestion;
}

export interface MessageSendOptions {
  replyToId?: string;
  retryMessageId?: string;
  retryAiMessageId?: string;
}

export interface AssistantKnowledgeSource {
  sourceId?: string;
  sourceName: string;
  canonicalKey?: string;
  objectType?: string;
  title?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  senderName?: string;
  senderRole?: string;
  senderColor?: string;
  isTyping?: boolean;
  actionSummary?: string;
  groundingUrls?: { uri: string; title: string }[];
  knowledgeSources?: AssistantKnowledgeSource[];
  thinkingText?: string;
  attachments?: MessageAttachment[];
  reactions?: Reaction[];
  documentSnapshot?: DocumentData;
  previousDocumentSnapshot?: DocumentData;
  documentActions?: string[];
  agentRole?: 'BA' | 'Orchestrator' | 'PO' | 'SM' | string;
  score?: number;
  scoreExplanation?: string;
  tokenCount?: number;
  thinkingTime?: number;
  questions?: Question[];
  createdAt?: number;
  ownerId?: string;
  rawResponse?: string;
  replyToId?: string;
  isError?: boolean;
  retryPayload?: {
    text: string;
    attachments?: MessageAttachment[];
    replyToId?: string;
    messageId: string;
    assistantMessageId: string;
  };
  persistenceStatus?: 'pending' | 'saved' | 'failed';
  provider?: 'openai' | 'gemini';
  responseModel?: string;
  fallbackUsed?: boolean;
  phase?: 'INTENT' | 'PLAN' | 'RESEARCH' | 'REFLECT' | 'ACT' | null;
  phaseLabel?: string;
}

export type WorkspaceType = 'Development' | 'Support' | 'Bug' | 'Improvement';
export type WorkspaceStatus = 'Draft' | 'In Progress' | 'Review' | 'Approved' | 'Completed';

export interface Collaborator {
  id: string;
  name: string;
  avatar?: string;
  role: string;
  color: string;
  email?: string;
}

export interface SectionData {
  content: string;
  status: 'DRAFT' | 'NEEDS_REVISION' | 'APPROVED';
  flags: string[];
}

export type ProjectMemoryItemType =
  | 'FACT'
  | 'DECISION'
  | 'CONSTRAINT'
  | 'ASSUMPTION'
  | 'OPEN_QUESTION'
  | 'PREFERENCE'
  | 'REQUIREMENT'
  | 'BUSINESS_RULE'
  | 'TERM';

export type ProjectMemorySourceType = 'USER' | 'DOCUMENT' | 'SYSTEM' | 'AI_INFERENCE' | 'LEGACY';
export type ProjectMemoryConfirmationStatus = 'CONFIRMED' | 'PROPOSED' | 'REJECTED';

export interface ProjectMemoryItem {
  id: string;
  key: string;
  type: ProjectMemoryItemType;
  value: string;
  sourceType: ProjectMemorySourceType;
  sourceId: string;
  confirmationStatus: ProjectMemoryConfirmationStatus;
  confidence: number;
  validFrom: string;
  version?: number;
  supersedes?: string;
}

export type DocumentQualityFindingSeverity = 'info' | 'warning' | 'error';

export interface DocumentQualityFinding {
  id: string;
  category: 'content' | 'template' | 'source' | 'traceability' | 'coverage' | 'consistency';
  severity: DocumentQualityFindingSeverity;
  message: string;
  recommendedAction?: string;
}

export interface DocumentQualityAssessment {
  evaluatedAt: string;
  score: number;
  canPublish: boolean;
  summary: string;
  findings: DocumentQualityFinding[];
  sourceConfidence?: number;
  templateCoverage?: {
    passed: number;
    total: number;
    missing: string[];
  };
}

export type EvidenceClaimStatus = 'VERIFIED' | 'INFERRED' | 'ASSUMPTION' | 'OPEN' | 'CONFLICTING';

export interface EvidenceClaim {
  claimId: string;
  claim: string;
  status: EvidenceClaimStatus;
  sourceUrl?: string;
  sourceTitle?: string;
  retrievedAt?: string;
  evidenceExcerpt?: string;
  confidence: number;
}

export interface ArtifactRevisionMetadata {
  revisionId: string;
  parentRevisionId?: string;
  sourceMessageIds: string[];
  changeSummary: string;
  changedSections: string[];
  updatedAt: string;
}

export interface DocumentData {
  /** Ana ve şimdilik tek üretim bölümü: kavramsal tasarım / BA analiz raporu. */
  businessAnalysis: SectionData;
  /** Kalite notları, açık sorular ve revizyon değerlendirmesi. */
  review?: SectionData;
  /** Geriye dönük uyumluluk için tutulur; yeni üretimde UI'da gösterilmez ve modelden istenmez. */
  code?: SectionData;
  /** Geriye dönük uyumluluk için tutulur; yeni üretimde UI'da gösterilmez ve modelden istenmez. */
  test?: SectionData;
  /** Geriye dönük uyumluluk için tutulur; yeni üretimde UI'da gösterilmez ve modelden istenmez. */
  bpmn?: SectionData;
  suggestions?: string[];
  score?: number;
  scoreExplanation?: string;
  /** Read-only quality output. It must never be used to rewrite document sections. */
  qualityAssessment?: DocumentQualityAssessment;
  /** Structured claim ledger. VERIFIED claims require URL, title, retrieval time and excerpt. */
  evidenceClaims?: EvidenceClaim[];
  /** Provenance and patch lineage for the current living artifact revision. */
  artifactMeta?: ArtifactRevisionMetadata;
}

export interface ActiveUser {
  id: string;
  name: string;
  role: string;
}

export interface TypingUser {
  userId: string;
  userName: string;
}

export interface Workspace {
  id: string;
  projectId: string;
  issueKey: string;
  title: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  messages: Message[];
  document: DocumentData | null;
  projectMemory?: Record<string, string>;
  memoryItems?: ProjectMemoryItem[];
  createdAt: number;
  lastUpdated: number;
  collaborators: Collaborator[];
  ownerId: string;
  archivedAt?: string | null;
  deletedAt?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  workspaces: Workspace[];
  createdAt: number;
  lastUpdated: number;
  ownerId: string;
  archivedAt?: string | null;
  deletedAt?: string | null;
}
