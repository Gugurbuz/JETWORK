import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_STALE_AFTER_MS,
  artifactModeForTask,
  artifactStaleBefore,
  shouldOpenAwaitingArtifactTask,
  type ArtifactTask,
} from '../artifactTaskRepository';

const task = (operation: 'create' | 'revise'): ArtifactTask => ({
  id: 'task-1',
  workspaceId: 'workspace-1',
  ownerId: 'owner-1',
  artifactType: 'business_analysis',
  operation,
  status: 'awaiting_input',
  requestText: 'Analiz dokümanını hazırla',
});

describe('artifact task continuation policy', () => {
  it('restores create/revise mode from a persisted active task', () => {
    expect(artifactModeForTask(task('create'))).toBe('create');
    expect(artifactModeForTask(task('revise'))).toBe('revise');
    expect(artifactModeForTask(null)).toBeUndefined();
  });

  it('opens awaiting_input only when clarification questions belong to a future artifact', () => {
    expect(shouldOpenAwaitingArtifactTask({
      questions: [{ id: 'q1', text: 'Bakanlık listesi nereden beslenecek?' }],
      text: 'Bu kararları netleştirdiğimizde ihtiyaç analizi dokümanını hazırlayabilirim.',
    })).toBe(true);

    expect(shouldOpenAwaitingArtifactTask({
      questions: [{ id: 'q1', text: 'Hangi tarih?' }],
      text: 'Soruyu yanıtladığında kısa bir değerlendirme yapabilirim.',
    })).toBe(false);

    expect(shouldOpenAwaitingArtifactTask({
      questions: [],
      text: 'İhtiyaç analizi dokümanını hazırlayabilirim.',
    })).toBe(false);
  });

  it('recognizes a future artifact promise carried in actionSummary', () => {
    expect(shouldOpenAwaitingArtifactTask({
      questions: [{ id: 'q1', text: 'Onay akışı nasıl çalışmalı?' }],
      text: 'Kararı netleştirelim.',
      actionSummary: 'Cevabın ardından iş analizi dokümanını oluşturacağım.',
    })).toBe(true);
  });

  it('uses a conservative ten-minute stale threshold for interrupted processing tasks', () => {
    const now = Date.parse('2026-08-08T12:30:00.000Z');
    expect(ARTIFACT_STALE_AFTER_MS).toBe(10 * 60 * 1000);
    expect(artifactStaleBefore(now)).toBe('2026-08-08T12:20:00.000Z');
  });
});
