export type MessageRole = 'user' | 'model';

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

export interface DocumentData {
  businessAnalysis: string;
  code: string;
  test: string;
  bpmn?: string;
  review?: string;
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
