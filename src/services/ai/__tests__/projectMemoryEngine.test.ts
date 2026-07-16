import { describe, expect, it } from 'vitest';
import { extractProjectMemoryUpdates } from '../projectMemoryEngine';

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
});
