export type MessageRole = 'user' | 'model';

export interface PromptSettings {
  systemInstruction: string;
  negativeConstraints: string;
  cotInstruction: string;
  totInstruction: string;
  reasoningFramework: 'standard' | 'cot' | 'tot';
  rolePersonas: Record<string, string>;
  fewShotLibrary: Record<string, string>;
  contextWindowSize: number;
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
  thinkingText?: string;
  attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[];
  reactions?: Reaction[];
  documentSnapshot?: DocumentData;
  previousDocumentSnapshot?: DocumentData;
  documentActions?: string[];
  agentRole?: 'BA' | 'IT' | 'QA' | 'Orchestrator' | 'PO' | 'SM' | string;
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
  retryPayload?: { text: string; attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[], replyToId?: string };
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

// YENİ EKLENEN KISIM: Ajanların birbirine itiraz edebilmesi (Flag) ve durum takibi için yapısal bölüm
export interface SectionData {
  content: string;
  status: 'DRAFT' | 'NEEDS_REVISION' | 'APPROVED'; // Ajanların o bölümdeki çalışma durumu
  flags: string[]; // Diğer ajanların (Örn QA'in) bu bölüme düştüğü hata/itiraz notları
}

// GÜNCELLENEN KISIM: DocumentData artık sadece metin değil, bir "Durum Makinesi"
export interface DocumentData {
  businessAnalysis: SectionData;
  code: SectionData;
  test: SectionData;
  bpmn?: SectionData;
  review?: SectionData;
  suggestions?: string[];
  score?: number;
  scoreExplanation?: string;
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
  issueKey: string; // e.g., JET-123
  title: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  messages: Message[];
  document: DocumentData | null;
  projectMemory?: Record<string, string>;
  createdAt: number;
  lastUpdated: number;
  collaborators: Collaborator[];
  ownerId: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  workspaces: Workspace[];
  createdAt: number;
  lastUpdated: number;
  ownerId: string;
}