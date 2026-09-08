import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownAZ, Loader2, MessageSquare, Search, Trash2, X } from 'lucide-react';
import { useDataStore } from '../store/useDataStore';
import { cn } from '../lib/utils';
import { FileViewer } from './FileViewer';
import { GeneratedFileCard } from './artifacts/GeneratedFileCard';
import {
  listWorkspaceFiles,
  softDeleteWorkspaceFile,
  type WorkspaceFileOrigin,
  type WorkspaceFileRecord,
  type WorkspaceFileSort,
} from '../services/workspaceFileRepository';
import type { WorkspaceFileKind } from '../lib/files/fileMeta';
import { toast } from 'sonner';

type FileOriginFilter = WorkspaceFileOrigin | 'all';
type FileKindFilter = WorkspaceFileKind | 'all';
const PAGE_SIZE = 100;

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
};

export function FileLibrary({ onClose }: { onClose: () => void }) {
  const projects = useDataStore(state => state.projects);
  const setCurrentWorkspaceId = useDataStore(state => state.setCurrentWorkspaceId);
  const [files, setFiles] = useState<WorkspaceFileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FileKindFilter>('all');
  const [origin, setOrigin] = useState<FileOriginFilter>('generated');
  const [sort, setSort] = useState<WorkspaceFileSort>('newest');
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileRecord | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const workspaceNames = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach(project => project.workspaces.forEach(workspace => map.set(workspace.id, workspace.title)));
    return map;
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void listWorkspaceFiles({ origin, fileKind: kind, search: query, sort, limit: PAGE_SIZE, offset: 0 })
        .then(records => {
          if (cancelled) return;
          setFiles(records);
          setHasMore(records.length === PAGE_SIZE);
        })
        .catch(error => {
          console.error('File library load failed:', error);
          if (!cancelled) {
            setFiles([]);
            setHasMore(false);
            toast.error('Dosya kütüphanesi yüklenemedi.');
          }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [origin, kind, query, sort, reloadToken]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !selectedFile) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, selectedFile]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const records = await listWorkspaceFiles({ origin, fileKind: kind, search: query, sort, limit: PAGE_SIZE, offset: files.length });
      setFiles(current => [...current, ...records]);
      setHasMore(records.length === PAGE_SIZE);
    } catch (error) {
      console.error('File library pagination failed:', error);
      toast.error('Daha fazla dosya yüklenemedi.');
    } finally {
      setLoadingMore(false);
    }
  };

  const goToConversation = (file: WorkspaceFileRecord) => {
    setCurrentWorkspaceId(file.workspaceId);
    onClose();
  };

  const removeFile = async (file: WorkspaceFileRecord) => {
    try {
      await softDeleteWorkspaceFile(file);
      if (selectedFile?.attachmentId === file.attachmentId) setSelectedFile(null);
      setReloadToken(value => value + 1);
      toast.success('Dosya kütüphaneden kaldırıldı.');
    } catch (error) {
      console.error('File soft-delete failed:', error);
      toast.error('Dosya kaldırılamadı.');
    }
  };

  const origins: Array<{ value: FileOriginFilter; label: string }> = [
    { value: 'generated', label: 'Oluşturulanlar' },
    { value: 'uploaded', label: 'Yüklenenler' },
    { value: 'all', label: 'Hepsi' },
  ];
  const kinds: Array<{ value: FileKindFilter; label: string }> = [
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
      <section className="fixed inset-y-3 left-3 right-3 z-[81] flex flex-col overflow-hidden rounded-2xl border border-theme-border/70 bg-theme-bg shadow-2xl sm:inset-y-8 sm:left-1/2 sm:right-auto sm:w-[min(1040px,calc(100vw-3rem))] sm:-translate-x-1/2" role="dialog" aria-modal="true" aria-label="Dosyalar">
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-theme-border/70 px-4 py-3 sm:px-5">
          <div><h2 className="text-sm font-semibold text-theme-text">Dosyalar</h2><p className="mt-0.5 text-[11px] text-theme-text-muted">Yüklediğin ve JetWork'ün oluşturduğu dosyalar · tüm sohbet geçmişi</p></div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" aria-label="Dosyaları kapat"><X size={18} /></button>
        </header>

        <div className="space-y-3 border-b border-theme-border/60 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Dosyalarda ara" className="h-10 w-full rounded-xl border border-theme-border bg-theme-surface/40 pl-9 pr-3 text-sm text-theme-text outline-none focus:border-theme-text-muted/50" /></div>
            <label className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-theme-border bg-theme-surface/40 px-3 text-xs text-theme-text-muted"><ArrowDownAZ size={14} /><select value={sort} onChange={event => setSort(event.target.value as WorkspaceFileSort)} className="bg-transparent text-theme-text outline-none"><option value="newest">En yeni</option><option value="oldest">En eski</option><option value="name">Ada göre</option></select></label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl bg-theme-surface/60 p-1">{origins.map(item => <button key={item.value} type="button" onClick={() => setOrigin(item.value)} className={cn('rounded-lg px-2.5 py-1.5 text-[11px]', origin === item.value ? 'bg-theme-bg font-medium text-theme-text shadow-sm' : 'text-theme-text-muted hover:text-theme-text')}>{item.label}</button>)}</div>
            <div className="flex flex-wrap gap-1">{kinds.map(item => <button key={item.value} type="button" onClick={() => setKind(item.value)} className={cn('rounded-lg border px-2.5 py-1.5 text-[11px]', kind === item.value ? 'border-theme-text-muted/40 bg-theme-surface font-medium text-theme-text' : 'border-theme-border text-theme-text-muted hover:text-theme-text')}>{item.label}</button>)}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-theme-text-muted"><Loader2 size={16} className="animate-spin" /> Dosyalar yükleniyor…</div> : files.length === 0 ? <div className="py-16 text-center text-sm text-theme-text-muted">Bu filtrelerde dosya bulunamadı.</div> : (
            <div className="grid gap-3 md:grid-cols-2">
              {files.map(file => (
                <div key={`${file.workspaceId}:${file.attachmentId}`} className="rounded-2xl border border-theme-border/70 bg-theme-surface/20 p-2">
                  <GeneratedFileCard file={file} onOpen={() => setSelectedFile(file)} />
                  <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-2 text-[10px] text-theme-text-muted">
                    <div className="min-w-0"><div className="truncate">{workspaceNames.get(file.workspaceId) || 'Sohbet'}</div><div>{formatDate(file.createdAt)} · {file.origin === 'generated' ? 'Oluşturulan' : 'Yüklenen'}</div></div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => goToConversation(file)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-theme-surface-hover hover:text-theme-text" title="Sohbete git" aria-label="Dosyanın bulunduğu sohbete git"><MessageSquare size={13} /></button>
                      <button type="button" onClick={() => void removeFile(file)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-red-500/10 hover:text-red-600" title="Kütüphaneden kaldır" aria-label="Dosyayı kütüphaneden kaldır"><Trash2 size={13} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {hasMore && !loading && <div className="flex justify-center py-5"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex h-9 items-center gap-2 rounded-xl border border-theme-border px-4 text-xs font-medium text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text disabled:opacity-60">{loadingMore && <Loader2 size={13} className="animate-spin" />} Daha fazla göster</button></div>}
        </div>

        {selectedFile && <div className="absolute inset-0 z-10 bg-theme-bg"><FileViewer file={selectedFile} onClose={() => setSelectedFile(null)} /></div>}
      </section>
    </>,
    document.body,
  );
}
