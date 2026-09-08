import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image,
  Loader2,
  Presentation,
  Search,
  X,
} from 'lucide-react';
import type { MessageAttachment } from '../types';
import { supabase } from '../supabase';
import { useDataStore } from '../store/useDataStore';
import { cn } from '../lib/utils';
import { FileViewer } from './FileViewer';

type FileKind = 'all' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image';
type FileOrigin = 'all' | 'generated' | 'uploaded';
type LibraryFile = MessageAttachment & {
  workspaceId: string;
  createdAt: string;
  workspaceTitle?: string;
};

interface FileVisual {
  label: string;
  icon: React.ReactNode;
  tileClass: string;
}

const extensionOf = (name?: string) => String(name || '').split('.').pop()?.toLocaleLowerCase('en-US') || '';

const fileKind = (file: MessageAttachment): Exclude<FileKind, 'all'> => {
  const ext = extensionOf(file.name);
  const mime = String(file.mimeType || '');
  if (ext === 'xlsx' || mime.includes('spreadsheet')) return 'spreadsheet';
  if (ext === 'pptx' || mime.includes('presentation')) return 'presentation';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
  return 'document';
};

const fileVisual = (file: MessageAttachment): FileVisual => {
  const ext = extensionOf(file.name);
  if (ext === 'docx') {
    return {
      label: 'Word belgesi',
      icon: <FileText size={19} />,
      tileClass: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400',
    };
  }
  if (ext === 'xlsx' || fileKind(file) === 'spreadsheet') {
    return {
      label: 'Excel çalışma kitabı',
      icon: <FileSpreadsheet size={19} />,
      tileClass: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    };
  }
  if (ext === 'pptx' || fileKind(file) === 'presentation') {
    return {
      label: 'PowerPoint sunumu',
      icon: <Presentation size={19} />,
      tileClass: 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400',
    };
  }
  if (ext === 'pdf' || fileKind(file) === 'pdf') {
    return {
      label: 'PDF belgesi',
      icon: <FileText size={19} />,
      tileClass: 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400',
    };
  }
  if (fileKind(file) === 'image') {
    return {
      label: 'Görsel',
      icon: <Image size={19} />,
      tileClass: 'border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400',
    };
  }
  return {
    label: ext ? `${ext.toLocaleUpperCase('tr-TR')} dosyası` : 'Dosya',
    icon: <FileText size={19} />,
    tileClass: 'border-theme-border bg-theme-surface text-theme-text-muted',
  };
};

const originOf = (file: MessageAttachment): Exclude<FileOrigin, 'all'> => (
  file.purpose === 'tool_output' ? 'generated' : 'uploaded'
);

const originLabel = (file: MessageAttachment) => (
  originOf(file) === 'generated' ? 'JetWork tarafından oluşturuldu' : 'Yüklenen dosya'
);

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function FileLibrary({ onClose }: { onClose: () => void }) {
  const projects = useDataStore(state => state.projects);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FileKind>('all');
  const [origin, setOrigin] = useState<FileOrigin>('generated');
  const [selectedFile, setSelectedFile] = useState<LibraryFile | null>(null);

  const workspaceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      for (const workspace of project.workspaces) map.set(workspace.id, workspace.title);
    }
    return map;
  }, [projects]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('messages')
        .select('workspace_id,attachments,created_at')
        .not('attachments', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (cancelled) return;
      if (error) {
        console.error('File library load failed:', error);
        setFiles([]);
        setLoading(false);
        return;
      }

      const seen = new Set<string>();
      const next: LibraryFile[] = [];

      for (const row of data || []) {
        const attachments = Array.isArray(row.attachments) ? row.attachments : [];
        for (const candidate of attachments) {
          if (!candidate || typeof candidate !== 'object') continue;
          const file = candidate as MessageAttachment;
          if (!file.storagePath && !file.url) continue;

          const key = file.attachmentId || file.storagePath || `${row.workspace_id}:${file.name || file.url}`;
          if (!key || seen.has(key)) continue;
          seen.add(key);

          next.push({
            ...file,
            workspaceId: String(row.workspace_id || ''),
            workspaceTitle: workspaceNames.get(String(row.workspace_id || '')),
            createdAt: String(row.created_at || ''),
          });
        }
      }

      setFiles(next);
      setLoading(false);
    };

    void load();
    return () => { cancelled = true; };
  }, [workspaceNames]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !selectedFile) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, selectedFile]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    return files.filter(file => {
      if (origin !== 'all' && originOf(file) !== origin) return false;
      if (filter !== 'all' && fileKind(file) !== filter) return false;
      if (!needle) return true;
      return [file.name, file.workspaceTitle, originLabel(file), fileVisual(file).label]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(needle);
    });
  }, [files, filter, origin, query]);

  const filters: Array<{ value: FileKind; label: string }> = [
    { value: 'all', label: 'Tümü' },
    { value: 'document', label: 'Belgeler' },
    { value: 'spreadsheet', label: 'Excel' },
    { value: 'presentation', label: 'Sunumlar' },
    { value: 'pdf', label: 'PDF' },
    { value: 'image', label: 'Görseller' },
  ];

  const origins: Array<{ value: FileOrigin; label: string }> = [
    { value: 'generated', label: 'Oluşturulanlar' },
    { value: 'uploaded', label: 'Yüklenenler' },
    { value: 'all', label: 'Hepsi' },
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-[1px]" onMouseDown={onClose} />
      <section
        className="fixed inset-y-3 left-3 right-3 z-[81] flex flex-col overflow-hidden rounded-2xl border border-theme-border/70 bg-theme-bg shadow-2xl sm:inset-y-8 sm:left-1/2 sm:right-auto sm:w-[min(960px,calc(100vw-3rem))] sm:-translate-x-1/2"
        role="dialog"
        aria-modal="true"
        aria-label="Dosyalar"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-theme-border/70 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-theme-text">Dosyalar</h2>
            <p className="mt-0.5 text-[11px] text-theme-text-muted">Yüklediğin ve JetWork'ün oluşturduğu dosyalar tek yerde</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text"
            aria-label="Dosyaları kapat"
          >
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-theme-border/60 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Dosyalarda ara"
                className="h-10 w-full rounded-xl border border-theme-border bg-theme-surface/40 pl-9 pr-3 text-sm text-theme-text outline-none focus:border-theme-text-muted/50"
              />
            </div>
            <div className="flex shrink-0 gap-1 rounded-xl bg-theme-surface/60 p-1">
              {origins.map(item => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setOrigin(item.value)}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                    origin === item.value
                      ? 'bg-theme-bg font-medium text-theme-text shadow-sm'
                      : 'text-theme-text-muted hover:text-theme-text',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {filters.map(item => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors',
                  filter === item.value
                    ? 'bg-theme-text text-theme-bg'
                    : 'bg-theme-surface text-theme-text-muted hover:text-theme-text',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-sm text-theme-text-muted">
              <Loader2 size={17} className="animate-spin" /> Dosyalar yükleniyor…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center text-theme-text-muted">
              <FolderOpen size={28} className="mb-3 opacity-60" />
              <p className="text-sm font-medium text-theme-text">Dosya bulunamadı</p>
              <p className="mt-1 max-w-sm text-xs">Filtreyi değiştir veya başka bir dosya adıyla ara.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visible.map(file => {
                const visual = fileVisual(file);
                return (
                  <button
                    key={file.attachmentId || file.storagePath || `${file.workspaceId}-${file.name}`}
                    type="button"
                    onClick={() => setSelectedFile(file)}
                    className="group flex min-w-0 items-center gap-3 rounded-2xl border border-theme-border/70 bg-theme-bg p-3 text-left transition hover:-translate-y-px hover:border-theme-text-muted/40 hover:bg-theme-surface/50 hover:shadow-sm"
                  >
                    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border', visual.tileClass)}>
                      {visual.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-theme-text-muted">{visual.label}</span>
                      <span className="mt-0.5 block truncate text-sm font-semibold text-theme-text">{file.name || 'Dosya'}</span>
                      <span className="mt-1 block truncate text-[10px] text-theme-text-muted">
                        {originLabel(file)}
                        {file.workspaceTitle ? ` · ${file.workspaceTitle}` : ''}
                        {file.createdAt ? ` · ${formatDate(file.createdAt)}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
      {selectedFile && <FileViewer file={selectedFile} onClose={() => setSelectedFile(null)} />}
    </>,
    document.body,
  );
}
