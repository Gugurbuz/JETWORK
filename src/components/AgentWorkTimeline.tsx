import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
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
import { splitAgentWorkTimeline } from '../services/agentActivityReducer';

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
    <li
      data-event-id={event.eventId}
      data-event-kind={event.kind}
      className={cn('assistant-work__activity', `assistant-work__activity--${event.state}`)}
    >
      <RowState event={event} />
      <span>{event.label}</span>
    </li>
  );
}

export function ToolActivityRow({ event }: { event: AgentWorkEvent }) {
  return (
    <li
      data-event-id={event.eventId}
      data-event-kind={event.kind}
      className={cn('assistant-work__activity assistant-work__activity--tool', `assistant-work__activity--${event.state}`)}
    >
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
    <li
      data-event-id={event.eventId}
      data-event-kind={event.kind}
      className={cn('assistant-work__activity assistant-work__activity--source', `assistant-work__activity--${event.state}`)}
    >
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

export function AgentWorkTimeline({
  events,
  live = false,
  compactAfter = 12,
}: {
  events: AgentWorkEvent[];
  live?: boolean;
  compactAfter?: number;
}) {
  const [showAllHistory, setShowAllHistory] = useState(false);
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const { hidden, visible } = splitAgentWorkTimeline(ordered, Math.max(6, compactAfter - 4));
  const displayed = showAllHistory ? ordered : visible;

  if (!ordered.length) return null;

  return (
    <div
      className={cn('assistant-work__details', live && 'assistant-work__details--live')}
      data-testid={live ? 'assistant-work-live-details' : 'assistant-work-details'}
      aria-live={live ? 'polite' : undefined}
    >
      {!showAllHistory && hidden.length > 0 ? (
        <button
          type="button"
          className="assistant-work__history-toggle"
          onClick={() => setShowAllHistory(true)}
          aria-label={`${hidden.length} önceki işlemi göster`}
        >
          <ChevronDown aria-hidden="true" />
          {hidden.length} işlem daha
        </button>
      ) : null}

      <ol className="assistant-work__activity-list">
        {displayed.map(renderEvent)}
      </ol>

      {showAllHistory && hidden.length > 0 ? (
        <button
          type="button"
          className="assistant-work__history-toggle assistant-work__history-toggle--close"
          onClick={() => setShowAllHistory(false)}
        >
          Geçmişi daralt
        </button>
      ) : null}
    </div>
  );
}
