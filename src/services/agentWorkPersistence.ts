import type {
  AgentWorkEvent,
  AgentWorkEventKind,
  AgentWorkEventState,
  AgentWorkSourceType,
} from './agentWorkTypes';

const PREFIX = 'jetwork-agent-work:v1:';
const MAX_EVENTS = 128;
const EVENT_STATES = new Set<AgentWorkEventState>(['pending', 'active', 'completed', 'warning', 'failed']);
const EVENT_KINDS = new Set<AgentWorkEventKind>(['agent', 'tool', 'source', 'artifact', 'warning', 'final']);
const SOURCE_TYPES = new Set<AgentWorkSourceType>(['knowledge', 'web', 'media', 'github', 'vercel', 'artifact', 'runtime']);

interface AgentWorkEnvelope {
  version: 1;
  workEvents: AgentWorkEvent[];
  rawResponse?: string;
}

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

const sanitizeEvent = (value: unknown): AgentWorkEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const eventId = clean(input.eventId, 240);
  const sequence = Number(input.sequence);
  const label = clean(input.label, 1_000);
  const state = clean(input.state, 40) as AgentWorkEventState;
  const kind = clean(input.kind, 40) as AgentWorkEventKind;
  const sourceType = clean(input.sourceType, 40) as AgentWorkSourceType;
  if (!eventId || !Number.isFinite(sequence) || sequence < 1 || !label) return null;
  if (!EVENT_STATES.has(state) || !EVENT_KINDS.has(kind)) return null;

  return {
    eventId,
    sequence: Math.trunc(sequence),
    kind,
    label,
    tool: clean(input.tool, 160) || undefined,
    sourceType: SOURCE_TYPES.has(sourceType) ? sourceType : 'runtime',
    startedAt: clean(input.startedAt, 80) || undefined,
    completedAt: clean(input.completedAt, 80) || undefined,
    state,
    rawLabel: clean(input.rawLabel, 1_000) || undefined,
  };
};

export function encodeAgentWorkEnvelope(workEvents: AgentWorkEvent[] = [], rawResponse?: string): string | undefined {
  const bounded = workEvents
    .slice(-MAX_EVENTS)
    .map(sanitizeEvent)
    .filter((event): event is AgentWorkEvent => Boolean(event))
    .sort((a, b) => a.sequence - b.sequence);
  if (!bounded.length) return rawResponse;

  const envelope: AgentWorkEnvelope = {
    version: 1,
    workEvents: bounded,
    rawResponse: rawResponse || undefined,
  };
  return `${PREFIX}${JSON.stringify(envelope)}`;
}

export function decodeAgentWorkEnvelope(value?: string | null): {
  workEvents: AgentWorkEvent[];
  rawResponse?: string;
} | null {
  const text = String(value || '');
  if (!text.startsWith(PREFIX)) return null;

  try {
    const parsed = JSON.parse(text.slice(PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || Number(parsed.version) !== 1) return null;
    const events = Array.isArray(parsed.workEvents)
      ? parsed.workEvents
        .slice(-MAX_EVENTS)
        .map(sanitizeEvent)
        .filter((event): event is AgentWorkEvent => Boolean(event))
        .sort((a, b) => a.sequence - b.sequence)
      : [];
    return {
      workEvents: events,
      rawResponse: typeof parsed.rawResponse === 'string' ? parsed.rawResponse : undefined,
    };
  } catch {
    return null;
  }
}

export const isAgentWorkEnvelope = (value?: string | null): boolean => (
  String(value || '').startsWith(PREFIX)
);
