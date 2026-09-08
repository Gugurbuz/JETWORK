import React from 'react';
import {
  AlertTriangle,
  Check,
  Database,
  FileText,
  GitBranch,
  Globe2,
  LoaderCircle,
  Rocket,
  Search,
  XCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { AgentWorkEvent } from '../services/agentWorkTypes';
import '../agent-work-timeline.css';

const GENERIC_KNOWLEDGE_ACTIVITY = /^(?:bilgi bankası sorgusu|bilgi bankasında sorgu|bilgi bankası işlemi)/iu;
const GENERIC_WEB_ACTIVITY = /^(?:web araması|web sorgusu|google araması|internet araması)/iu;
const NUMERIC_SOURCE_ACTIVITY = /^\d+\s+(?:kurumsal|web)\s+kaynak(?:\s+|\s*·\s*|$).*(?:bulundu|kullanıldı|incelendi)?/iu;

const StateIcon = ({ state }: { state: AgentWorkEvent['state'] }) => {
  if (state === 'failed') return <XCircle aria-hidden="true" />;
  if (state === 'warning') return <AlertTriangle aria-hidden="true" />;
  if (state === 'active' || state === 'pending') return <LoaderCircle aria-hidden="true" />;
  return <Check aria-hidden="true" />;
};

const ToolIcon = ({ event }: { event: AgentWorkEvent }) => {
  if (event.sourceType === 'knowledge') return <Database aria-hidden="true" />;
  if (event.sourceType === 'web') return <Globe2 aria-hidden="true" />;
  if (event.sourceType === 'github') return <GitBranch aria-hidden="true" />;
  if (event.sourceType === 'vercel') return <Rocket aria-hidden="true" />;
  if (event.sourceType === 'artifact') return <FileText aria-hidden="true" />;
  return <Search aria-hidden="true" />;
};

const RowState = ({ event }: { event: AgentWorkEvent }) => (
  <span className="assistant-work__activity-icon">
    <StateIcon state={event.state} />
  </span>
);

export function AgentActivityRow({ event }: { event: AgentWorkEvent }) {
  return (
    <li data-event-id={event.eventId} data-event-kind={event.kind} className={cn('assistant-work__activity assistant-work__activity--semantic', `assistant-work__activity--${event.state}`)}>
      <RowState event={event} />
      <span>{event.label}</span>
    </li>
  );
}

export function ToolActivityRow({ event }: { event: AgentWorkEvent }) {
  return (
    <li data-event-id={event.eventId} data-event-kind={event.kind} className={cn('assistant-work__activity assistant-work__activity--tool', `assistant-work__activity--${event.state}`)}>
      <span className="assistant-work__tool-icon"><ToolIcon event={event} /></span>
      <span className="assistant-work__activity-copy">
        <strong>{event.tool || 'JetWork'}</strong>
        <span>{event.label}</span>
      </span>
      <RowState event={event} />
    </li>
  );
}

export function SourceActivityRow({ event }: { event: AgentWorkEvent }) {
  return (
    <li data-event-id={event.eventId} data-event-kind={event.kind} className={cn('assistant-work__activity assistant-work__activity--source', `assistant-work__activity--${event.state}`)}>
      <span className="assistant-work__tool-icon"><ToolIcon event={event} /></span>
      <span className="assistant-work__activity-copy">
        <strong>{event.tool || 'Kaynaklar'}</strong>
        <span>{event.label}</span>
      </span>
      <RowState event={event} />
    </li>
  );
}

const renderEvent = (event: AgentWorkEvent) => {
  if (event.kind === 'tool' || event.kind === 'artifact') return <ToolActivityRow key={event.eventId} event={event} />;
  if (event.kind === 'source') return <SourceActivityRow key={event.eventId} event={event} />;
  return <AgentActivityRow key={event.eventId} event={event} />;
};

const genericToolFamily = (event: AgentWorkEvent): 'knowledge' | 'web' | null => {
  if (event.kind !== 'tool') return null;
  if (event.sourceType === 'knowledge' && GENERIC_KNOWLEDGE_ACTIVITY.test(event.label)) return 'knowledge';
  if (event.sourceType === 'web' && GENERIC_WEB_ACTIVITY.test(event.label)) return 'web';
  return null;
};

/**
 * Persisted Agent Work remains a complete event chronology. This function is
 * presentation-only: it removes misleading rolling source-count snapshots and
 * collapses repetitive generic provider tool rows between semantic controller
 * updates. Public controller commentary (goal, plan, finding, plan change) is
 * never collapsed, so the user can follow why the work is progressing.
 */
export function compactAgentWorkTimelinePresentation(events: AgentWorkEvent[]): AgentWorkEvent[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const result: AgentWorkEvent[] = [];
  let batch: { family: 'knowledge' | 'web'; index: number; count: number } | null = null;

  const resetBatch = () => { batch = null; };

  for (const event of ordered) {
    if (event.kind === 'source' && NUMERIC_SOURCE_ACTIVITY.test(event.label)) {
      // The dedicated Sources view reports the deduplicated distinct documents.
      // Intermediate object-count snapshots (1 -> 21 -> 46...) are intentionally
      // not repeated in the work narrative.
      continue;
    }

    const family = genericToolFamily(event);
    if (!family) {
      resetBatch();
      result.push(event);
      continue;
    }

    if (!batch || batch.family !== family) {
      const label = event.state === 'active' || event.state === 'pending'
        ? family === 'knowledge' ? 'Bilgi bankası sorgusu çalışıyor...' : 'Web araması çalışıyor...'
        : family === 'knowledge' ? '1 bilgi bankası işlemi tamamlandı' : '1 web araması tamamlandı';
      result.push({
        ...event,
        eventId: `presentation-batch:${family}:${event.eventId}`,
        label,
      });
      batch = { family, index: result.length - 1, count: 1 };
      continue;
    }

    batch.count += 1;
    const prior = result[batch.index];
    const active = event.state === 'active' || event.state === 'pending';
    result[batch.index] = {
      ...prior,
      state: event.state,
      completedAt: event.completedAt || prior.completedAt,
      label: active
        ? `${batch.count}. ${family === 'knowledge' ? 'bilgi bankası işlemi' : 'web araması'} sürüyor...`
        : `${batch.count} ${family === 'knowledge' ? 'bilgi bankası işlemi' : 'web araması'} tamamlandı`,
    };
  }

  return result;
}

export function AgentWorkTimeline({ events, live = false }: { events: AgentWorkEvent[]; live?: boolean }) {
  const ordered = compactAgentWorkTimelinePresentation(events);
  if (!ordered.length) return null;

  return (
    <div
      className={cn('assistant-work__details', live && 'assistant-work__details--live')}
      data-testid={live ? 'assistant-work-live-details' : 'assistant-work-details'}
      aria-live={live ? 'polite' : undefined}
    >
      <ol className="assistant-work__activity-list">{ordered.map(renderEvent)}</ol>
    </div>
  );
}