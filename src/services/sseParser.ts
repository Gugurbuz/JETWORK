import { reduceAgentActivityEvents } from './agentActivityReducer';
import { observeAgentWorkSseEvent } from './agentWorkLiveStream';
import type { AgentWorkEvent } from './agentWorkTypes';

export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
}

const EMPTY_AGENT_WORK_EVENTS: AgentWorkEvent[] = [];
let parsedAgentWorkEvents: AgentWorkEvent[] = EMPTY_AGENT_WORK_EVENTS;

const captureCanonicalAgentWorkEvent = (input: SseEvent) => {
  const observed = observeAgentWorkSseEvent(input);
  if (!observed) return;
  const base = observed.sequence === 1 ? EMPTY_AGENT_WORK_EVENTS : parsedAgentWorkEvents;
  parsedAgentWorkEvents = reduceAgentActivityEvents(base, observed);
};

function parseFrame(frame: string): SseEvent | null {
  const data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const separator = rawLine.indexOf(':');
    const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
    const value = separator >= 0 ? rawLine.slice(separator + 1).replace(/^ /, '') : '';
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
  }

  if (data.length === 0) return null;
  const parsed = { data: data.join('\n'), event, id };
  captureCanonicalAgentWorkEvent(parsed);
  return parsed;
}

export function consumeSseBuffer(
  buffer: string,
  flush = false,
): { events: SseEvent[]; remainder: string } {
  const events: SseEvent[] = [];
  let cursor = 0;
  const separator = /\r?\n\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(buffer)) !== null) {
    const frame = buffer.slice(cursor, match.index);
    const parsed = parseFrame(frame);
    if (parsed) events.push(parsed);
    cursor = match.index + match[0].length;
  }

  let remainder = buffer.slice(cursor);
  if (flush && remainder.trim()) {
    const parsed = parseFrame(remainder);
    if (parsed) events.push(parsed);
    remainder = '';
  }

  return { events, remainder };
}

export const getParsedAgentWorkEvents = (): AgentWorkEvent[] => parsedAgentWorkEvents;

export const resetParsedAgentWorkEvents = () => {
  parsedAgentWorkEvents = EMPTY_AGENT_WORK_EVENTS;
};

export const resetParsedAgentWorkEventsForTests = resetParsedAgentWorkEvents;
