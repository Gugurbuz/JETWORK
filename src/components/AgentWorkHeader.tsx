import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { JetWorkLogo } from './JetWorkLogo';

interface AgentWorkHeaderProps {
  isActive: boolean;
  duration: string;
  elapsedSeconds: number;
  expanded: boolean;
  expandable: boolean;
  isStopped?: boolean;
  onToggle?: () => void;
}

export function AgentWorkHeader({
  isActive,
  duration,
  elapsedSeconds,
  expanded,
  expandable,
  isStopped = false,
  onToggle,
}: AgentWorkHeaderProps) {
  const content = isActive ? (
    <>
      <span className="assistant-work__logo-stage" aria-hidden="true">
        <span className="assistant-work__logo-motion">
          <JetWorkLogo className="assistant-work__logo" />
        </span>
      </span>
      <span className="assistant-work__label">Düşünüyor</span>
      <span className="assistant-work__separator" aria-hidden="true">·</span>
      <time className="assistant-work__time">{duration}</time>
    </>
  ) : (
    <>
      <span data-testid="assistant-work-completed-logo" className="assistant-work__logo-stage" aria-hidden="true">
        <JetWorkLogo className="assistant-work__logo" />
      </span>
      <span>{duration} düşündü{isStopped ? ' · durduruldu' : ''}</span>
    </>
  );

  if (!expandable) {
    return (
      <div className={cn(isActive ? 'assistant-work__topline' : 'assistant-work__summary assistant-work__summary--static')}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(isActive ? 'assistant-work__topline assistant-work__topline--button' : 'assistant-work__summary')}
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={isActive
        ? `Çalışma ayrıntılarını ${expanded ? 'gizle' : 'göster'}, ${elapsedSeconds} saniye`
        : 'Çalışma ayrıntılarını göster'}
    >
      {content}
      <ChevronDown className={cn('assistant-work__chevron', expanded && 'assistant-work__chevron--open')} aria-hidden="true" />
    </button>
  );
}
