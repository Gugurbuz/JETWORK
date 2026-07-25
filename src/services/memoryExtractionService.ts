import type { DocumentData, KnowledgeItem } from '../types';
import { extractKeyFacts, extractKeywords } from './contextManager';
import { extractProjectMemoryUpdates, mergeProjectMemory } from './ai/projectMemoryEngine';
import { saveProjectMemory } from './projectMemoryRepository';

export async function persistTurnMemory(input: {
  workspaceId: string;
  messageId: string;
  userMessage: string;
  document: DocumentData | null;
  currentMemory: Record<string, string>;
}): Promise<Record<string, string> | null> {
  const updates = extractProjectMemoryUpdates({
    userMessage: input.userMessage,
    document: input.document,
  });
  if (!Object.keys(updates).length) return null;

  const result = await saveProjectMemory(input.workspaceId, updates, input.messageId);
  if (!result.ok) throw new Error(result.error || 'Project memory persistence failed.');
  return mergeProjectMemory(input.currentMemory, updates);
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
      keywords: extractKeywords(fact.fact).slice(0, 12),
      importance: fact.importance,
      createdAt: Date.now(),
      projectId: workspaceId,
    }));
}
