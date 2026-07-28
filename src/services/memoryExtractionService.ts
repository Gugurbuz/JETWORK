import type { KnowledgeItem, ProjectMemoryItem } from '../types';
import { extractKeyFacts } from './contextManager';
import {
  extractStructuredProjectMemory,
  mergeStructuredProjectMemory,
} from './ai/projectMemoryEngine';
import { saveProjectMemoryItems } from './projectMemoryRepository';

export async function persistTurnMemory(input: {
  workspaceId: string;
  messageId: string;
  userMessage: string;
  currentMemoryItems: ProjectMemoryItem[];
}): Promise<ProjectMemoryItem[] | null> {
  const updates = extractStructuredProjectMemory({
    userMessage: input.userMessage,
    sourceId: input.messageId,
    existing: input.currentMemoryItems,
  });
  if (!updates.length) return null;

  const result = await saveProjectMemoryItems(input.workspaceId, updates);
  if (!result.ok) throw new Error(result.error || 'Project memory persistence failed.');
  return mergeStructuredProjectMemory(input.currentMemoryItems, updates);
}

export async function extractKnowledgeItems(
  workspaceId: string,
  text: string,
): Promise<KnowledgeItem[]> {
  const facts = await extractKeyFacts(text);
  return facts
    .filter(fact => fact.importance >= 5)
    .map(fact => ({
      id: crypto.randomUUID(),
      content: fact.fact,
      keywords: fact.fact.toLowerCase().split(' ').slice(0, 5),
      importance: fact.importance,
      createdAt: Date.now(),
      projectId: workspaceId,
    }));
}
