import { useSyncExternalStore } from 'react';
import { reduceAgentActivityEvents } from './agentActivityReducer';
import type {
  AgentWorkEvent,
  AgentWorkEventKind,
  AgentWorkEventState,
  AgentWorkSourceType,
} from './agentWorkTypes';

interface SseLikeEvent {
  data: string;
  event?: string;
}

type Listener = () => void;

const CANONICAL_EVENT_NAMES = new Set([
  'agent_activity',
  'tool_start',
  'tool_complete',
  'artifact',
  'warning',
  'final',
]);
const EVENT_STATES = new Set<AgentWorkEventState>(['pending', 'active', 'completed', 'warning', 'failed']);
const SOURCE_TYPES = new Set<AgentWorkSourceType>(['knowledge', 'web', 'media', 'github', 'vercel', 'artifact', 'runtime']);
const EMPTY_EVENTS: AgentWorkEvent[] = [];

let snapshot: AgentWorkEvent[] = EMPTY_EVENTS;
const listeners = new Set<Listener>();
const persistedSnapshots = new Map<number, AgentWorkEvent[]>();
const persistedListeners = new Set<Listener>();

const emit = () => listeners.forEach(listener => listener());
const emitPersisted = () => persistedListeners.forEach(listener => listener());

const startedAtKey = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const mapKind = (value: unknown, eventName: string): AgentWorkEventKind => {
  const kind = String(value || '').trim();
  if (kind === 'tool' || eventName === 'tool_start' || eventName === 'tool_complete') return 'tool';
  if (kind === 'source') return 'source';
  if (kind === 'artifact' || eventName === 'artifact') return 'artifact';
  if (kind === 'warning' || eventName === 'warning') return 'warning';
  if (kind === 'final' || eventName === 'final') return 'final';
  return 'agent';
};

const parseCanonicalAgentWorkEvent = (input: SseLikeEvent): AgentWorkEvent | null => {
  const eventName = String(input.event || '').trim();
  if (!CANONICAL_EVENT_NAMES.has(eventName) || !input.data || input.data === '[DONE]') return null;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.data);
    if (!parsed || typeof parsed !== 'object') return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const eventId = String(payload.event_id || '').trim();
  const sequence = Number(payload.sequence);
  const label = String(payload.label || '').trim();
  if (!eventId || !Number.isFinite(sequence) || sequence < 1 || !label) return null;

  const rawState = String(payload.state || '').trim() as AgentWorkEventState;
  const state: AgentWorkEventState = EVENT_STATES.has(rawState)
    ? rawState
    : eventName === 'tool_start'
      ? 'active'
      : eventName === 'warning'
        ? 'warning'
        : 'completed';
  const rawSourceType = String(payload.source_type || '').trim() as AgentWorkSourceType;
  const sourceType: AgentWorkSourceType = SOURCE_TYPES.has(rawSourceType) ? rawSourceType : 'runtime';

  return {
    eventId,
    sequence,
    kind: mapKind(payload.kind, eventName),
    label,
    rawLabel: label,
    tool: payload.tool ? String(payload.tool).trim() || undefined : undefined,
    sourceType,
    startedAt: payload.started_at ? String(payload.started_at) : undefined,
    completedAt: payload.completed_at ? String(payload.completed_at) : undefined,
    state,
  };
};

export const observeAgentWorkSseEvent = (input: SseLikeEvent): AgentWorkEvent | null => {
  const event = parseCanonicalAgentWorkEvent(input);
  if (!event) return null;

  // Every canonical stream starts sequencing from one. Reset the singleton
  // snapshot at that boundary so a new turn can never inherit the previous
  // turn's activity chronology.
  const base = event.sequence === 1 ? EMPTY_EVENTS : snapshot;
  const next = reduceAgentActivityEvents(base, event);
  const changed = next.length !== snapshot.length
    || next.some((item, index) => item !== snapshot[index]);
  snapshot = next;
  if (changed) emit();
  return event;
};

export const getAgentWorkLiveSnapshot = (): AgentWorkEvent[] => snapshot;

export const resetAgentWorkLiveSnapshot = () => {
  snapshot = EMPTY_EVENTS;
  emit();
};

export const resetAgentWorkLiveSnapshotForTests = resetAgentWorkLiveSnapshot;

export const registerPersistedAgentWorkEvents = (startedAt: unknown, events: AgentWorkEvent[] = []) => {
  const key = startedAtKey(startedAt);
  if (key === null || !events.length) return;
  persistedSnapshots.set(key, [...events].sort((a, b) => a.sequence - b.sequence));
  emitPersisted();
};

export const getPersistedAgentWorkEvents = (startedAt: unknown): AgentWorkEvent[] => {
  const key = startedAtKey(startedAt);
  return key === null ? EMPTY_EVENTS : persistedSnapshots.get(key) || EMPTY_EVENTS;
};

export const resetPersistedAgentWorkEventsForTests = () => {
  persistedSnapshots.clear();
  emitPersisted();
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const subscribePersisted = (listener: Listener) => {
  persistedListeners.add(listener);
  return () => persistedListeners.delete(listener);
};

export function useAgentWorkLiveEvents(enabled = true): AgentWorkEvent[] {
  return useSyncExternalStore(
    enabled ? subscribe : () => () => undefined,
    enabled ? getAgentWorkLiveSnapshot : () => EMPTY_EVENTS,
    () => EMPTY_EVENTS,
  );
}

export function usePersistedAgentWorkEvents(startedAt?: number): AgentWorkEvent[] {
  return useSyncExternalStore(
    subscribePersisted,
    () => getPersistedAgentWorkEvents(startedAt),
    () => EMPTY_EVENTS,
  );
}
