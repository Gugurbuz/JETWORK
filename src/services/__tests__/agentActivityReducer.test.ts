import { describe, expect, it } from 'vitest';
import {
  completeActiveAgentEvents,
  createObservedAgentWorkEvent,
  diffRollingActivitySnapshot,
  formatAgentActivityLabel,
  reduceAgentActivityEvents,
  sourceCountAgentWorkEvent,
  splitAgentWorkTimeline,
} from '../agentActivityReducer';
import type { AgentWorkEvent } from '../agentWorkTypes';

const event = (eventId: string, sequence: number, state: AgentWorkEvent['state'] = 'active'): AgentWorkEvent => ({
  eventId,
  sequence,
  kind: 'tool',
  tool: 'Bilgi Bankası',
  sourceType: 'knowledge',
  label: `İşlem ${sequence}`,
  state,
});

describe('AgentActivityReducer', () => {
  it('updates tool_start/tool_complete with the same event id instead of adding a second row', () => {
    const started = event('tool-call-1', 3, 'active');
    const completed = { ...started, state: 'completed' as const, label: 'Bilgi bankası tarandı', completedAt: '2026-09-06T20:00:01.000Z' };
    const afterStart = reduceAgentActivityEvents([], started);
    const afterComplete = reduceAgentActivityEvents(afterStart, completed);

    expect(afterComplete).toHaveLength(1);
    expect(afterComplete[0]).toMatchObject({ eventId: 'tool-call-1', sequence: 3, state: 'completed', label: 'Bilgi bankası tarandı' });
  });

  it('keeps different tool calls even when their labels are identical', () => {
    const first = event('tool-call-1', 1, 'completed');
    const second = { ...event('tool-call-2', 2, 'completed'), label: first.label };
    const state = reduceAgentActivityEvents(reduceAgentActivityEvents([], first), second);

    expect(state.map(item => item.eventId)).toEqual(['tool-call-1', 'tool-call-2']);
  });

  it('preserves ordered completed history and never truncates reducer state', () => {
    let state: AgentWorkEvent[] = [];
    for (let sequence = 1; sequence <= 20; sequence += 1) {
      state = reduceAgentActivityEvents(state, event(`event-${sequence}`, sequence, 'completed'));
    }

    expect(state).toHaveLength(20);
    expect(state.at(0)?.eventId).toBe('event-1');
    expect(state.at(-1)?.eventId).toBe('event-20');
  });

  it('compacts only presentation history and always keeps the active event visible', () => {
    const state = Array.from({ length: 15 }, (_, index) => event(`event-${index + 1}`, index + 1, index === 3 ? 'active' : 'completed'));
    const compact = splitAgentWorkTimeline(state, 8);

    expect(compact.hidden.length + compact.visible.length).toBe(15);
    expect(compact.visible.some(item => item.eventId === 'event-4')).toBe(true);
    expect(state).toHaveLength(15);
  });

  it('detects only new entries in a rolling legacy status window', () => {
    expect(diffRollingActivitySnapshot(
      ['A', 'B', 'C', 'D'],
      ['B', 'C', 'D', 'E'],
    )).toEqual(['E']);
  });

  it('maps runtime telemetry to public presentation text without exposing controller jargon', () => {
    expect(formatAgentActivityLabel('Semantic capability adayları çıkarılıyor...', false)).toBe('Uygun kaynak ve araçları değerlendiriyorum...');
    expect(formatAgentActivityLabel('Controller ek capability/kanıt çağrısı yapıyor...', true)).toBe('Bulduğum bilgi ek kaynaklarla doğrulandı');
  });

  it('creates typed source events and completes active work at turn completion', () => {
    const observed = createObservedAgentWorkEvent({ rawLabel: 'Bilgi bankası taranıyor', sequence: 1, active: true });
    expect(observed).toMatchObject({ kind: 'tool', tool: 'Bilgi Bankası', state: 'active' });
    const withSource = sourceCountAgentWorkEvent({ sequence: 2, sourceType: 'knowledge', count: 3 });
    expect(withSource).toMatchObject({ kind: 'source', label: '3 kurumsal kaynak bulundu', state: 'completed' });
    expect(completeActiveAgentEvents(observed ? [observed, withSource] : [withSource])[0].state).toBe('completed');
  });
});
