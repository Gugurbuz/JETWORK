import { beforeEach, describe, expect, it } from 'vitest';
import { consumeSseBuffer } from '../sseParser';
import {
  getAgentWorkLiveSnapshot,
  resetAgentWorkLiveSnapshotForTests,
} from '../agentWorkLiveStream';

const sse = (event: string, payload: Record<string, unknown>) => (
  `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
);

describe('canonical Agent Work SSE client bridge', () => {
  beforeEach(() => resetAgentWorkLiveSnapshotForTests());

  it('updates tool_start -> tool_complete in place by event_id', () => {
    consumeSseBuffer([
      sse('tool_start', {
        event_id: 'tool:1',
        sequence: 1,
        kind: 'tool',
        label: 'Bilgi bankasında CHECK_ZTKS aranıyor...',
        tool: 'Bilgi Bankası',
        source_type: 'knowledge',
        started_at: '2026-09-06T20:00:00.000Z',
        state: 'active',
      }),
      sse('tool_complete', {
        event_id: 'tool:1',
        sequence: 1,
        kind: 'tool',
        label: 'Bilgi bankasında CHECK_ZTKS incelendi',
        tool: 'Bilgi Bankası',
        source_type: 'knowledge',
        started_at: '2026-09-06T20:00:00.000Z',
        completed_at: '2026-09-06T20:00:02.000Z',
        state: 'completed',
      }),
    ].join(''));

    expect(getAgentWorkLiveSnapshot()).toEqual([expect.objectContaining({
      eventId: 'tool:1',
      sequence: 1,
      kind: 'tool',
      tool: 'Bilgi Bankası',
      sourceType: 'knowledge',
      state: 'completed',
      label: 'Bilgi bankasında CHECK_ZTKS incelendi',
    })]);
  });

  it('keeps source and final events ordered after the CHECK_ZTKS lookup', () => {
    consumeSseBuffer([
      sse('tool_start', {
        event_id: 'tool:1', sequence: 1, kind: 'tool',
        label: 'Bilgi bankasında CHECK_ZTKS aranıyor...', tool: 'Bilgi Bankası',
        source_type: 'knowledge', state: 'active',
      }),
      sse('tool_complete', {
        event_id: 'tool:1', sequence: 1, kind: 'tool',
        label: 'Bilgi bankasında CHECK_ZTKS incelendi', tool: 'Bilgi Bankası',
        source_type: 'knowledge', state: 'completed',
      }),
      sse('agent_activity', {
        event_id: 'source:2', sequence: 2, kind: 'source',
        label: '3 kurumsal kaynak bulundu', tool: 'Bilgi Bankası',
        source_type: 'knowledge', state: 'completed',
      }),
      sse('final', {
        event_id: 'final:3', sequence: 3, kind: 'final',
        label: 'Yanıt oluşturuldu', source_type: 'runtime', state: 'completed',
      }),
    ].join(''));

    expect(getAgentWorkLiveSnapshot().map(event => [event.eventId, event.state])).toEqual([
      ['tool:1', 'completed'],
      ['source:2', 'completed'],
      ['final:3', 'completed'],
    ]);
  });

  it('resets chronology when a new canonical stream starts at sequence one', () => {
    consumeSseBuffer(sse('agent_activity', {
      event_id: 'final:9', sequence: 9, kind: 'final', label: 'Eski yanıt', state: 'completed',
    }));
    consumeSseBuffer(sse('agent_activity', {
      event_id: 'status:1', sequence: 1, kind: 'status', label: 'Yeni talep işleme alındı', state: 'active',
    }));

    expect(getAgentWorkLiveSnapshot()).toHaveLength(1);
    expect(getAgentWorkLiveSnapshot()[0]).toEqual(expect.objectContaining({
      eventId: 'status:1',
      label: 'Yeni talep işleme alındı',
      state: 'active',
    }));
  });
});
