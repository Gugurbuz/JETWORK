import type { DocumentData, SectionData } from '../types';

export const ARTIFACT_SECTION_KEYS = [
  'businessAnalysis',
  'review',
  'code',
  'test',
  'bpmn',
] as const;

export type ArtifactSectionKey = typeof ARTIFACT_SECTION_KEYS[number];

export interface ArtifactSectionChange {
  section: ArtifactSectionKey;
  before?: SectionData;
  after?: SectionData;
}

export interface ArtifactPatch {
  patchId: string;
  sourceMessageId: string;
  parentRevisionId?: string;
  createdAt: string;
  changes: ArtifactSectionChange[];
  changeSummary: string;
  proposedDocument: DocumentData;
}

const equalSection = (left?: SectionData, right?: SectionData): boolean => (
  JSON.stringify(left || null) === JSON.stringify(right || null)
);

const sectionLabel = (section: ArtifactSectionKey): string => ({
  businessAnalysis: 'BA Analiz',
  review: 'Review',
  code: 'Code',
  test: 'Test',
  bpmn: 'BPMN',
})[section];

export function createArtifactPatch(
  existingDocument: DocumentData | null,
  proposedDocument: DocumentData,
  sourceMessageId: string,
  createdAt = new Date().toISOString(),
): ArtifactPatch {
  const changes = ARTIFACT_SECTION_KEYS.flatMap((section) => {
    const before = existingDocument?.[section];
    const after = proposedDocument[section];
    if (equalSection(before, after)) return [];
    return [{ section, before, after }];
  });

  const changedLabels = changes.map(change => sectionLabel(change.section));
  return {
    patchId: crypto.randomUUID(),
    sourceMessageId,
    parentRevisionId: existingDocument?.artifactMeta?.revisionId,
    createdAt,
    changes,
    changeSummary: changedLabels.length
      ? `${changedLabels.join(', ')} bölümleri güncellendi.`
      : 'Belge içeriğinde bölüm değişikliği yok.',
    proposedDocument,
  };
}

export function applyArtifactPatch(
  existingDocument: DocumentData | null,
  patch: ArtifactPatch,
): DocumentData {
  const proposed = patch.proposedDocument;
  const next: DocumentData = {
    ...(existingDocument || proposed),
    suggestions: proposed.suggestions,
    score: proposed.score,
    scoreExplanation: proposed.scoreExplanation,
    qualityAssessment: proposed.qualityAssessment,
    evidenceClaims: proposed.evidenceClaims,
    artifactMeta: {
      revisionId: patch.patchId,
      parentRevisionId: patch.parentRevisionId,
      sourceMessageIds: Array.from(new Set([
        ...(existingDocument?.artifactMeta?.sourceMessageIds || []),
        patch.sourceMessageId,
      ])).slice(-20),
      changeSummary: patch.changeSummary,
      changedSections: patch.changes.map(change => change.section),
      updatedAt: patch.createdAt,
    },
  };

  for (const change of patch.changes) {
    if (change.after) {
      next[change.section] = change.after;
    } else {
      delete next[change.section];
    }
  }

  return next;
}
