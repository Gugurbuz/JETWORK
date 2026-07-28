import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import { applyArtifactPatch, createArtifactPatch } from '../artifactPatch';

const baseDocument = (): DocumentData => ({
  businessAnalysis: {
    content: '# Kararlar\n- Müşteri tipi CRM tarafından belirlenir.',
    status: 'APPROVED',
    flags: [],
  },
  review: {
    content: '# Açık Konular\n- SLA netleştirilecek.',
    status: 'DRAFT',
    flags: [],
  },
  artifactMeta: {
    revisionId: 'revision-1',
    sourceMessageIds: ['message-1'],
    changeSummary: 'İlk sürüm',
    changedSections: ['businessAnalysis', 'review'],
    updatedAt: '2026-07-24T10:00:00.000Z',
  },
});

describe('artifactPatch', () => {
  it('updates only changed sections and preserves prior decisions', () => {
    const existing = baseDocument();
    const proposed: DocumentData = {
      ...existing,
      review: {
        content: '# Açık Konular\n- SLA: 4 saat olarak netleştirildi.',
        status: 'APPROVED',
        flags: [],
      },
    };

    const patch = createArtifactPatch(
      existing,
      proposed,
      'message-2',
      '2026-07-25T10:00:00.000Z',
    );
    const result = applyArtifactPatch(existing, patch);

    expect(patch.changes.map(change => change.section)).toEqual(['review']);
    expect(result.businessAnalysis).toBe(existing.businessAnalysis);
    expect(result.businessAnalysis.content).toContain('CRM tarafından belirlenir');
    expect(result.review).toEqual(proposed.review);
  });

  it('records revision lineage and source-message provenance', () => {
    const existing = baseDocument();
    const proposed: DocumentData = {
      ...existing,
      businessAnalysis: {
        ...existing.businessAnalysis,
        content: `${existing.businessAnalysis.content}\n- Manuel müşteri tipi değişikliği yasaktır.`,
      },
    };

    const result = applyArtifactPatch(
      existing,
      createArtifactPatch(existing, proposed, 'message-2', '2026-07-25T10:00:00.000Z'),
    );

    expect(result.artifactMeta?.parentRevisionId).toBe('revision-1');
    expect(result.artifactMeta?.sourceMessageIds).toEqual(['message-1', 'message-2']);
    expect(result.artifactMeta?.changedSections).toEqual(['businessAnalysis']);
    expect(existing.businessAnalysis.content).not.toContain('Manuel');
  });

  it('produces an empty patch for an unchanged artifact', () => {
    const existing = baseDocument();
    const patch = createArtifactPatch(existing, { ...existing }, 'message-2');

    expect(patch.changes).toEqual([]);
    expect(patch.changeSummary).toContain('değişikliği yok');
  });
});
