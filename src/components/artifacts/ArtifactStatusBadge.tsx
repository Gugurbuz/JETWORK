import React from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { artifactStateIsFailure, artifactStateLabel, type ArtifactRuntimeState } from '../../services/artifactAttachment';
import { cn } from '../../lib/utils';

export function ArtifactStatusBadge({ state }: { state?: ArtifactRuntimeState | null }) {
  if (!state) return null;
  const failed = artifactStateIsFailure(state);
  const complete = state === 'completed';
  const Icon = failed ? AlertCircle : complete ? CheckCircle2 : Loader2;
  return (
    <span
      data-artifact-state={state}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        failed
          ? 'border-red-500/25 bg-red-500/10 text-red-600'
          : complete
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'border-theme-border bg-theme-surface text-theme-text-muted',
      )}
    >
      <Icon size={11} className={!failed && !complete ? 'animate-spin' : undefined} aria-hidden="true" />
      {artifactStateLabel(state)}
    </span>
  );
}
