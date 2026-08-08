import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Archive, CheckCircle2, Database, FileText, FolderKanban,
  Globe2, Loader2, RefreshCw, RotateCcw, Search, Trash2, Upload, X,
} from 'lucide-react';
import {
  type KnowledgeScope,
  type KnowledgeSourceSummary,
  archiveKnowledgeSource,
  deleteKnowledgeSource,
  ingestKnowledgeFile,
  listKnowledgeSources,
  publishKnowledgeSource,
  resolveKnowledgeContext,
} from '../services/knowledgeCatalogRepository';

interface Props { workspaceId: string; onClose: () => void; }
type Filter = 'all' | 'published' | 'draft' | 'archived' | 'failed';

const label = (source: KnowledgeSourceSummary) => source.ingestionStatus === 'failed' ? 'İşleme hatası'
  : source.ingestionStatus !== 'ready' ? 'İşleniyor'
  : source.publicationStatus === 'published' ? 'Yayında'
  : source.publicationStatus === 'archived' ? 'Arşivde' : 'İnceleme bekliyor';

export function KnowledgeBankModal({ workspaceId, onClose }: Props) {
  const [scope, setScope] = useState<KnowledgeScope>('global');
  const [hasProjectScope, setHasProjectScope] = useState(false);
  const [sources, setSources] = useState<KnowledgeSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveKnowledgeContext(workspaceId)
      .then(context => {
        if (!cancelled) setHasProjectScope(Boolean(context.projectSpaceId));
      })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Bilgi kapsamı çözümlenemedi.');
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSources(await listKnowledgeSources(workspaceId, scope));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bilgi bankası okunamadı.');
    } finally {
      setLoading(false);
    }
  }, [scope, workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const visible = useMemo(() => sources.filter(source => {
    const matchesFilter = filter === 'all'
      || (filter === 'failed' ? source.ingestionStatus === 'failed' : source.publicationStatus === filter);
    return matchesFilter
      && [source.name, source.documentType]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(query.trim().toLocaleLowerCase('tr-TR'));
  }), [sources, query, filter]);

  const act = async (source: KnowledgeSourceSummary, action: 'publish' | 'archive' | 'delete') => {
    setBusyId(source.id);
    setError(null);
    try {
      if (action === 'publish') await publishKnowledgeSource(source.id);
      if (action === 'archive') await archiveKnowledgeSource(source.id);
      if (action === 'delete') await deleteKnowledgeSource(source);
      setConfirmDeleteId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaynak güncellenemedi. Bu kaynak başka bir kullanıcı tarafından yönetiliyor olabilir.');
    } finally {
      setBusyId(null);
    }
  };

  const uploadFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await ingestKnowledgeFile(workspaceId, file, scope);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaynak yüklenemedi.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const scopeDescription = scope === 'global'
    ? 'Tüm JetWork kullanıcılarının ve tüm projelerin ortak, kalıcı bilgi kaynağı.'
    : 'Yalnızca bu projede kullanılan proje özelindeki bilgi kaynağı.';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-theme-border bg-theme-bg shadow-2xl">
        <header className="flex items-center gap-3 border-b border-theme-border px-5 py-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-theme-primary/10 text-theme-primary"><Database size={20} /></div>
          <div className="min-w-0">
            <h2 className="font-semibold text-theme-text">Bilgi Bankası</h2>
            <p className="truncate text-xs text-theme-text-muted">{scopeDescription}</p>
          </div>
          <button type="button" onClick={() => void refresh()} className="ml-auto rounded-lg p-2 hover:bg-theme-surface" title="Yenile">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-theme-surface" aria-label="Kapat"><X size={18} /></button>
        </header>

        <div className="flex items-center gap-1 border-b border-theme-border px-4 pt-2">
          <button
            type="button"
            onClick={() => setScope('global')}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${scope === 'global' ? 'border-theme-text text-theme-text' : 'border-transparent text-theme-text-muted hover:text-theme-text'}`}
          >
            <Globe2 size={15} /> JetWork Bilgi Bankası
          </button>
          {hasProjectScope && (
            <button
              type="button"
              onClick={() => setScope('project')}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${scope === 'project' ? 'border-theme-text text-theme-text' : 'border-transparent text-theme-text-muted hover:text-theme-text'}`}
            >
              <FolderKanban size={15} /> Proje Bilgisi
            </button>
          )}
        </div>

        <div className="space-y-3 border-b border-theme-border p-4 sm:flex sm:items-center sm:space-y-0 sm:gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-2.5 text-theme-text-muted" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Kaynak ara" className="w-full rounded-lg border border-theme-border bg-theme-surface py-2 pl-9 pr-3 text-sm outline-none" />
          </div>
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)} className="rounded-lg border border-theme-border bg-theme-surface px-3 py-2 text-sm">
            <option value="all">Tümü</option><option value="published">Yayında</option><option value="draft">Taslak</option><option value="archived">Arşivde</option><option value="failed">Hatalı</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="text/plain,text/markdown,.txt,.md"
            className="hidden"
            onChange={event => void uploadFile(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-theme-text px-3.5 py-2 text-sm font-semibold text-theme-bg disabled:opacity-50"
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {scope === 'global' ? 'Global Kaynak Ekle' : 'Proje Kaynağı Ekle'}
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && <div className="mb-4 flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"><AlertCircle size={16} />{error}</div>}
          {loading && sources.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-theme-text-muted"><Loader2 className="animate-spin" size={18} />Kaynaklar okunuyor…</div>
          ) : visible.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-theme-border text-center">
              <FileText size={28} className="mb-3 text-theme-text-muted" />
              <p className="text-sm font-medium">Bu kapsamda henüz kaynak yok</p>
              <p className="mt-1 max-w-md text-xs text-theme-text-muted">
                {scope === 'global'
                  ? 'Buraya eklenen ve yayımlanan kaynaklar tüm JetWork kullanıcıları tarafından kullanılabilir.'
                  : 'Buraya eklenen kaynaklar yalnız bu proje bağlamındaki AI aramalarına eklenir.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">{visible.map(source => {
              const published = source.publicationStatus === 'published';
              const canPublish = source.ingestionStatus === 'ready' && !published;
              return (
                <article key={source.id} className="rounded-xl border border-theme-border bg-theme-surface/50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <FileText size={18} className="mt-0.5 shrink-0 text-theme-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">{source.name}</p>
                        <span className="rounded-full bg-theme-bg px-2 py-0.5 text-[10px] font-semibold">{label(source)}</span>
                        <span className="rounded-full border border-theme-border px-2 py-0.5 text-[10px] text-theme-text-muted">{scope === 'global' ? 'GLOBAL' : 'PROJECT'}</span>
                      </div>
                      <p className="mt-1 text-xs text-theme-text-muted">v{source.latestVersion} · {source.objectCount} nesne · {source.relationCount} ilişki{source.documentType ? ` · ${source.documentType}` : ''}</p>
                      <p className="mt-1 text-[10px] text-theme-text-muted">Son güncelleme: {new Date(source.updatedAt).toLocaleString('tr-TR')}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {published ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={15} />AI kullanabilir</span>
                      ) : (
                        <button type="button" disabled={!canPublish || busyId === source.id} onClick={() => void act(source, 'publish')} className="flex items-center gap-1 rounded-lg bg-theme-primary px-3 py-1.5 text-xs font-semibold text-theme-primary-fg disabled:opacity-50"><RotateCcw size={13} />Yayınla</button>
                      )}
                      {source.publicationStatus !== 'archived' && <button type="button" disabled={busyId === source.id} onClick={() => void act(source, 'archive')} className="rounded-lg border border-theme-border p-2 text-theme-text-muted" title="Arşivle"><Archive size={14} /></button>}
                      {confirmDeleteId === source.id ? (
                        <><button type="button" onClick={() => void act(source, 'delete')} disabled={busyId === source.id} className="rounded-lg bg-red-600 px-2 py-1.5 text-xs font-semibold text-white">Evet, sil</button><button type="button" onClick={() => setConfirmDeleteId(null)} className="text-xs">Vazgeç</button></>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(source.id)} className="rounded-lg border border-red-500/30 p-2 text-red-500" title="Kalıcı sil"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}</div>
          )}
        </div>
      </div>
    </div>
  );
}
