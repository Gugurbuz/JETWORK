import React from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { MessageAttachment } from '../../types';
import { cn } from '../../lib/utils';
import { fileVisualMeta } from '../../lib/files/fileMeta';
import { artifactAttachmentMeta, type ArtifactAwareAttachment } from '../../services/artifactAttachment';
import { createAssistantFileDownloadUrl } from '../../services/assistantFileRepository';
import { ArtifactStatusBadge } from './ArtifactStatusBadge';
import { toast } from 'sonner';

interface GeneratedFileCardProps {
  file: MessageAttachment;
  onOpen?: (file: MessageAttachment) => void;
  compact?: boolean;
  showDownload?: boolean;
  className?: string;
}

export function GeneratedFileCard({ file, onOpen, compact = false, showDownload = true, className }: GeneratedFileCardProps) {
  const visual = fileVisualMeta(file);
  const meta = artifactAttachmentMeta(file);
  const enriched = file as ArtifactAwareAttachment;

  const download = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const url = file.url || await createAssistantFileDownloadUrl(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name || 'jetwork-output';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error('Generated file download failed:', error);
      toast.error('Dosya indirme bağlantısı oluşturulamadı.');
    }
  };

  return (
    <div
      data-testid="generated-file-card"
      data-jetwork-file-kind={visual.kind}
      className={cn(
        'group/file flex min-w-0 items-center gap-3 rounded-2xl border border-theme-border/70 bg-theme-bg p-3 text-left shadow-sm transition hover:border-theme-text-muted/40 hover:bg-theme-surface/60',
        compact ? 'max-w-[360px]' : 'w-full',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onOpen?.(file)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`${visual.label}: ${file.name || 'JetWork çıktısı'}. Aç`}
      >
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold tracking-tight', visual.tileClass)}>
          {visual.mark}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium text-theme-text-muted">{visual.label}</span>
            {meta.artifactVersion && <span className="text-[10px] font-semibold text-theme-text-muted">v{meta.artifactVersion}</span>}
            <ArtifactStatusBadge state={meta.artifactState} />
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-theme-text">{file.name || 'JetWork çıktısı'}</span>
          {enriched.sha256 && <span className="mt-1 block truncate font-mono text-[9px] text-theme-text-muted/70">{enriched.sha256.slice(0, 12)}</span>}
        </span>
        <ExternalLink size={14} className="shrink-0 text-theme-text-muted transition group-hover/file:text-theme-text" aria-hidden="true" />
      </button>
      {showDownload && (
        <button
          type="button"
          onClick={download}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text"
          aria-label={`${file.name || 'Dosya'} indir`}
          title="İndir"
        >
          <Download size={14} />
        </button>
      )}
    </div>
  );
}
