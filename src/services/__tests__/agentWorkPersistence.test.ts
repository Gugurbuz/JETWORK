import { describe, expect, it } from 'vitest';
import {
  decodeAgentWorkEnvelope,
  encodeAgentWorkEnvelope,
  isAgentWorkEnvelope,
} from '../agentWorkPersistence';
import {
  getPersistedAgentWorkEvents,
  registerPersistedAgentWorkEvents,
  resetPersistedAgentWorkEventsForTests,
} from '../agentWorkLiveStream';
import type { AgentWorkEvent } from '../agentWorkTypes';

const event = (sequence: number, label = 'Aynı görünür etiket'): AgentWorkEvent => ({
  eventId: `tool:${sequence}`,
  sequence,
  kind: 'tool',
  label,
  rawLabel: label,
  tool: 'Bilgi Bankası',
  sourceType: 'knowledge',
  state: 'completed',
  startedAt: `2026-09-06T20:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
  completedAt: `2026-09-06T20:00:${String(sequence % 60).padStart(2, '0')}.500Z`,
});

describe('Agent Work durable chronology envelope', () => {
  it('round-trips duplicate labels without merging distinct event ids', () => {
    const encoded = encodeAgentWorkEnvelope([event(1), event(2)], 'raw-model-text');
    expect(encoded).toBeTruthy();
    expect(isAgentWorkEnvelope(encoded)).toBe(true);

    const decoded = decodeAgentWorkEnvelope(encoded);
    expect(decoded?.rawResponse).toBe('raw-model-text');
    expect(decoded?.workEvents.map(item => item.eventId)).toEqual(['tool:1', 'tool:2']);
    expect(decoded?.workEvents.map(item => item.label)).toEqual([
      'Aynı görünür etiket',
      'Aynı görünür etiket',
    ]);
  });

  it('does not silently truncate long completed histories', () => {
    const original = Array.from({ length: 160 }, (_, index) => event(index + 1, `İşlem ${index + 1}`));
    const decoded = decodeAgentWorkEnvelope(encodeAgentWorkEnvelope(original));

    expect(decoded?.workEvents).toHaveLength(160);
    expect(decoded?.workEvents[0].eventId).toBe('tool:1');
    expect(decoded?.workEvents.at(-1)?.eventId).toBe('tool:160');
  });

  it('leaves pre-existing plain raw responses untouched', () => {
    expect(decodeAgentWorkEnvelope('plain legacy response')).toBeNull();
    expect(encodeAgentWorkEnvelope([], 'plain legacy response')).toBe('plain legacy response');
  });

  it('hydrates persisted chronology by the message createdAt used by the indicator', () => {
    resetPersistedAgentWorkEventsForTests();
    const startedAt = Date.parse('2026-09-06T20:00:00.000Z');
    registerPersistedAgentWorkEvents(startedAt, [event(2), event(1)]);

    expect(getPersistedAgentWorkEvents(startedAt).map(item => item.eventId)).toEqual(['tool:1', 'tool:2']);
  });
});
