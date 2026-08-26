import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  FileSpreadsheet,
  FileText,
  FlaskConical,
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
type LibraryFile = MessageAttachment & {
  workspaceId: string;
  createdAt: string;
  workspaceTitle?: string;
};

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

const iconFor = (file: MessageAttachment) => {
  const kind = fileKind(file);
  if (kind === 'spreadsheet') return <FileSpreadsheet size={18} />;
  if (kind === 'presentation') return <Presentation size={18} />;
  if (kind === 'image') return <Image size={18} />;
  return <FileText size={18} />;
};

const typeLabel = (file: MessageAttachment) => {
  const ext = extensionOf(file.name);
  if (ext === 'docx') return 'Word belgesi';
  if (ext === 'xlsx') return 'Excel çalışma kitabı';
  if (ext === 'pptx') return 'PowerPoint sunumu';
  if (ext === 'pdf') return 'PDF';
  if (fileKind(file) === 'image') return 'Görsel';
  return ext ? ext.toUpperCase() : 'Dosya';
};

const originLabel = (file: MessageAttachment) => file.purpose === 'tool_output' ? 'JetWork çıktısı' : 'Yüklenen dosya';

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

export function AppUtilityDock() {
  const navigate = useNavigate();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => {
    const resolve = () => {
      const aside = document.querySelector<HTMLElement>('aside');
      if (!aside) {
        setPortalTarget(null);
        return;
      }

      const footer = Array.from(aside.children).at(-1);
      setPortalTarget(footer instanceof HTMLElement ? footer : null);
      setCompact(aside.getBoundingClientRect().width < 100);
    };

    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const aside = portalTarget?.closest('aside');
    if (!(aside instanceof HTMLElement)) return;

    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width || aside.getBoundingClientRect().width;
      setCompact(width < 100);
    });
    observer.observe(aside);
    return () => observer.disconnect();
  }, [portalTarget]);

  const dock = portalTarget ? createPortal(
    <div
      className={cn(
        'absolute bottom-full z-30 mb-1 rounded-xl bg-theme-surface p-1 shadow-sm',
        compact ? 'left-1/2 flex -translate-x-1/2 flex-col gap-1' : 'left-2 right-2 space-y-1',
      )}
      aria-label="Uygulama araçları"
    >
      <button
        type="button"
        onClick={() => setFilesOpen(true)}
        className={cn(
          'flex h-10 items-center rounded-xl text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text',
          compact ? 'w-10 justify-center' : 'w-full gap-3 px-3 text-sm',
        )}
        aria-label="Dosyalar"
        title="Dosyalar"
      >
        <FolderOpen size={18} />
        {!compact && <span>Dosyalar</span>}
      </button>

      <button
        type="button"
        onClick={() => navigate('/quality')}
        className={cn(
          'flex h-10 items-center rounded-xl text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text',
          compact ? 'w-10 justify-center' : 'w-full gap-3 px-3 text-sm',
        )}
        aria-label="AI Quality Lab"
        title="AI Quality Lab"
      >
        <FlaskConical size={18} />
        {!compact && <span>AI Quality Lab</span>}
      </button>
    </div>,
    portalTarget,
  ) : null;

  return (
    <>
      {dock}
      {filesOpen && <FileLibraryDialog onClose={() => setFilesOpen(false)} />}
    </>
  );
}

function FileLibraryDialog({ onClose }: { onClose: () => void }) {
  const projects = useDataStore(state => state.projects);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FileKind>('all');
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
      if (filter !== 'all' && fileKind(file) !== filter) return false;
      if (!needle) return true;
      return [file.name, file.workspaceTitle, originLabel(file)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(needle);
    });
  }, [files, filter, query]);

  const filters: Array<{ value: FileKind; label: string }> = [
    { value: 'all', label: 'Tümü' },
    { value: 'document', label: 'Belgeler' },
    { value: 'spreadsheet', label: 'Excel' },
    { value: 'presentation', label: 'Sunumlar' },
    { value: 'pdf', label: 'PDF' },
    { value: 'image', label: 'Görseller' },
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-[1px]" onMouseDown={onClose} />
      <section
        className="fixed inset-y-3 left-3 right-3 z-[81] flex flex-col overflow-hidden rounded-2xl border border-theme-border/70 bg-theme-bg shadow-2xl sm:inset-y-8 sm:left-1/2 sm:right-auto sm:w-[min(920px,calc(100vw-3rem))] sm:-translate-x-1/2"
        role="dialog"
        aria-modal="true"
        aria-label="Dosyalar"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-theme-border/70 px-4">
          <div>
            <h2 className="text-sm font-semibold text-theme-text">Dosyalar</h2>
            <p className="text-[11px] text-theme-text-muted">Yüklediğin ve JetWork'ün oluşturduğu dosyalar</p>
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

        <div className="border-b border-theme-border/60 px-4 py-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Dosyalarda ara"
              className="h-10 w-full rounded-xl border border-theme-border bg-theme-surface/40 pl-9 pr-3 text-sm text-theme-text outline-none focus:border-theme-text-muted/50"
            />
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

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-sm text-theme-text-muted">
              <Loader2 size={17} className="animate-spin" /> Dosyalar yükleniyor…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center text-theme-text-muted">
              <FolderOpen size={28} className="mb-3 opacity-60" />
              <p className="text-sm font-medium text-theme-text">Dosya bulunamadı</p>
              <p className="mt-1 text-xs">Yüklenen veya oluşturulan dosyalar burada görünür.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visible.map(file => (
                <button
                  key={file.attachmentId || file.storagePath || `${file.workspaceId}-${file.name}`}
                  type="button"
                  onClick={() => setSelectedFile(file)}
                  className="group flex min-w-0 items-center gap-3 rounded-xl border border-theme-border/70 bg-theme-bg p-3 text-left transition hover:-translate-y-px hover:border-theme-text-muted/40 hover:bg-theme-surface/50"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-theme-surface text-theme-text-muted group-hover:text-theme-text">
                    {iconFor(file)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-theme-text">{file.name || 'Dosya'}</span>
                    <span className="mt-1 block truncate text-[11px] text-theme-text-muted">
                      {typeLabel(file)} · {originLabel(file)}
                      {file.workspaceTitle ? ` · ${file.workspaceTitle}` : ''}
                      {file.createdAt ? ` · ${formatDate(file.createdAt)}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      {selectedFile && <FileViewer file={selectedFile} onClose={() => setSelectedFile(null)} />}
    </>,
    document.body,
  );
}
