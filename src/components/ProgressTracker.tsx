import React from 'react';
import { WorkspaceStatus } from '../types';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';

interface ProgressTrackerProps {
  status: WorkspaceStatus;
  className?: string;
}

const STAGES: WorkspaceStatus[] = ['Draft', 'In Progress', 'Review', 'Approved', 'Completed'];

export function ProgressTracker({ status, className }: ProgressTrackerProps) {
  const currentIndex = STAGES.indexOf(status);

  return (
    <div className={cn("flex items-center gap-1 w-full", className)}>
      {STAGES.map((stage, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isPending = index > currentIndex;

        return (
          <div key={stage} className="flex-1 flex flex-col gap-1.5 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-theme-primary text-theme-primary-fg text-[10px] font-bold uppercase tracking-widest rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
              {stage}
            </div>
            
            {/* Bar */}
            <div className={cn(
              "h-1.5 w-full rounded-full transition-colors duration-300",
              isCompleted && "bg-theme-primary",
              isCurrent && "bg-theme-primary/60 animate-pulse",
              isPending && "bg-theme-border"
            )} />
            
            {/* Optional: Tiny label for current stage only, or hidden by default */}
            {isCurrent && (
              <span className="text-[8px] font-bold uppercase tracking-widest text-theme-primary absolute top-full left-0 mt-0.5 truncate max-w-full">
                {stage}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
