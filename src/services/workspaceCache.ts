import type { DocumentData, Message } from '../types';

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Failed to parse workspace cache key ${key}:`, error);
    return null;
  }
}

export function readWorkspaceCache(workspaceId: string): {
  messages: Message[] | null;
  document: DocumentData | null;
  memory: Record<string, string> | null;
} {
  return {
    messages: readJson<Message[]>(`jetwork_messages_${workspaceId}`),
    document: readJson<DocumentData>(`jetwork_document_${workspaceId}`),
    memory: readJson<Record<string, string>>(`jetwork_project_memory_${workspaceId}`),
  };
}

export function cacheWorkspaceMessages(workspaceId: string, messages: Message[]): void {
  if (messages.length) localStorage.setItem(`jetwork_messages_${workspaceId}`, JSON.stringify(messages));
}

export function cacheWorkspaceDocument(workspaceId: string, document: DocumentData): void {
  localStorage.setItem(`jetwork_document_${workspaceId}`, JSON.stringify(document));
}

export function cacheWorkspaceMemory(workspaceId: string, memory: Record<string, string>): void {
  localStorage.setItem(`jetwork_project_memory_${workspaceId}`, JSON.stringify(memory));
}
