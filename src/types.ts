export type MessageRole = 'user' | 'model';

export interface Reaction {
  emoji: string;
  users: string[];
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  senderName?: string;
  senderRole?: string;
  isTyping?: boolean;
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
}

export type WorkspaceType = 'Development' | 'Support' | 'Bug' | 'Improvement';
export type WorkspaceStatus = 'Draft' | 'In Progress' | 'Review' | 'Approved' | 'Completed';

export interface Collaborator {
  id: string;
  name: string;
  avatar: string;
  role: string;
  color: string;
}

export interface DocumentData {
  businessAnalysis: string;
  code: string;
  test: string;
  bpmn?: string;
  review?: string;
  thoughtProcess?: string;
  suggestions?: string[];
  score?: number;
  scoreExplanation?: string;
  conflictAnalysis?: string;
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
  issueKey: string; // e.g., JET-123
  title: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  messages: Message[];
  document: DocumentData | null;
  createdAt: number;
  lastUpdated: number;
  collaborators: Collaborator[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  workspaces: Workspace[];
  createdAt: number;
  lastUpdated: number;
}
