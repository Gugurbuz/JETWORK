import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { mergeAiChunk, mergeAiEnd } from '../workspaceRealtimeTransport';

describe('workspace realtime AI stream reducer', () => {
  it('merges chunks by message id without creating duplicates', () => {
    const first = mergeAiChunk([], { id: 'ai-1', text: 'partial' });
    const second = mergeAiChunk(first, { id: 'ai-1', text: 'longer partial' });

    expect(second).toHaveLength(1);
    expect(second[0].text).toBe('longer partial');
    expect(second[0].isTyping).toBe(true);
  });

  it('ignores a late chunk after the final event', () => {
    const initial = [{ id: 'ai-1', role: 'model', text: 'partial', isTyping: true }] as Message[];
    const completed = mergeAiEnd(initial, { id: 'ai-1', text: 'final' });
    const late = mergeAiChunk(completed, { id: 'ai-1', text: 'stale partial' });

    expect(late[0].text).toBe('final');
    expect(late[0].isTyping).toBe(false);
  });
});
