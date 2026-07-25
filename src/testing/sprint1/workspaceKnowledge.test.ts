import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '../../types';
import { mergeWorkspaceKnowledgeResults } from '../../services/workspaceKnowledgeRepository';

const item = (id: string, content: string, similarity?: number): KnowledgeItem => ({
  id,
  content,
  keywords: content.toLowerCase().split(/\s+/),
  importance: 8,
  createdAt: 1,
  projectId: 'workspace-a',
  similarity,
});

describe('Sprint 1 workspace hybrid retrieval', () => {
  it('deduplicates keyword and embedding hits while preserving semantic ranking', () => {
    const results = mergeWorkspaceKnowledgeResults(
      [item('keyword', 'Toplu işlem limiti 500 kayıttır')],
      [
        item('semantic-duplicate', 'Toplu işlem limiti 500 kayıttır', 0.92),
        item('semantic', 'Başarısız kayıtlar ayrı listelenir', 0.81),
      ],
      5,
    );

    expect(results).toHaveLength(2);
    expect(results[0].similarity).toBe(0.92);
  });
});
