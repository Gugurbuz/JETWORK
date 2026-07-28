import { describe, expect, it } from 'vitest';
import {
  extractProjectMemoryUpdates,
  extractStructuredProjectMemory,
  getActiveMemoryItems,
  mergeStructuredProjectMemory,
} from '../projectMemoryEngine';

describe('projectMemoryEngine', () => {
  it('does not infer system capabilities from generated document text', () => {
    const updates = extractProjectMemoryUpdates({
      userMessage: 'Dokumanlar Word kavramsal tasarim formatinda olsun.',
      document: {
        businessAnalysis: {
          content: '# KAVRAMSAL TASARIM RAPORU',
          status: 'DRAFT',
          flags: [],
        },
        review: {
          content: 'Copilot Cognitive Decision Trace\nCopilot Runtime State Machine\nEvidence Ledger',
          status: 'DRAFT',
          flags: [],
        },
      },
    });

    expect(updates['preference.document_format']).toBeTruthy();
    expect(Object.keys(updates).some(key => key.startsWith('system.'))).toBe(false);
  });

  it('does not promote AI output into project memory', () => {
    const updates = extractProjectMemoryUpdates({
      userMessage: 'Bu öneriyi değerlendir.',
      aiMessage: 'Karar: Müşteri tipi her zaman CRM tarafından belirlenir.',
    });

    expect(Object.keys(updates).some(key => key.startsWith('decision.'))).toBe(false);
  });

  it('stores explicit user decisions with provenance and supersedes changed values', () => {
    const first = extractStructuredProjectMemory({
      userMessage: 'Karar: iade limiti 5.000 TL.',
      sourceId: 'user-message-1',
      now: '2026-07-24T10:00:00.000Z',
    });
    const second = extractStructuredProjectMemory({
      userMessage: 'Karar: iade limiti artık 10.000 TL.',
      sourceId: 'user-message-2',
      existing: first,
      now: '2026-07-25T10:00:00.000Z',
    });
    const merged = mergeStructuredProjectMemory(first, second);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      sourceType: 'USER',
      sourceId: 'user-message-1',
      confirmationStatus: 'CONFIRMED',
      confidence: 1,
    });
    expect(second[0].supersedes).toBe(first[0].id);
    expect(getActiveMemoryItems(merged)).toEqual([second[0]]);
  });

  it('does not duplicate an unchanged confirmed value', () => {
    const first = extractStructuredProjectMemory({
      userMessage: 'Karar: müşteri tipini yalnız CRM belirler.',
      sourceId: 'user-message-1',
    });
    const duplicate = extractStructuredProjectMemory({
      userMessage: 'Karar: müşteri tipini yalnız CRM belirler.',
      sourceId: 'user-message-2',
      existing: first,
    });

    expect(duplicate).toEqual([]);
  });
});
