import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Check,
  Clock3,
  Database,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Globe2,
  History,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
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
import {
  getKnowledgeGraphHealth,
  listKnowledgeReviewItems,
  listKnowledgeSourceVersions,
  type KnowledgeGraphHealth,
  type KnowledgeReviewItem,
  type KnowledgeSourceVersion,
} from '../services/knowledgeAdminRepository';

interface Props { workspaceId: string; onClose: () => void; }
type LibrarySection = 'all' | 'recent' | 'images' | 'documents' | 'tables' | 'admin';

const emptyHealth: KnowledgeGraphHealth = {
  objectCount: 0,
  activeRelationCount: 0,
  syntheticObjectCount: 0,
  danglingRelationCount: 0,
  openReviewCount: 0,
};

const formatDate = (value: string) => new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}).format(new Date(value));

const fileType = (source: KnowledgeSourceSummary) => {
  const mime = source.mediaType.toLocaleLowerCase('en-US');
  const name = source.name.toLocaleLowerCase('en-US');
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(name)) return 'image';
  if (mime.includes('spreadsheet') || mime.includes('excel') || /\.(xlsx|xls|csv|tsv)$/i.test(name)) return 'table';
  return 'document';
};

const fileTypeLabel = (source: KnowledgeSourceSummary) => {
  const name = source.name.toLocaleLowerCase('en-US');
  if (name.endsWith('.pdf')) return 'PDF';
  if (name.endsWith('.docx')) return 'Word';
  if (name.endsWith('.pptx')) return 'PowerPoint';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'Excel';
  if (name.endsWith('.md')) return 'Markdown';
  if (name.endsWith('.txt')) return 'TXT';
  if (name.endsWith('.csv')) return 'CSV';
  if (fileType(source) === 'image') return 'Görsel';
  return source.documentType || 'Doküman';
};

const sourceStatus = (source: KnowledgeSourceSummary) => {
  if (source.ingestionStatus === 'failed') return { label: 'Hata', tone: 'text-red-600 bg-red-500/10' };
  if (source.ingestionStatus !== 'ready') return { label: 'İşleniyor', tone: 'text-amber-600 bg-amber-500/10' };
  if (source.publicationStatus === 'published') return { label: 'Hazır', tone: 'text-emerald-600 bg-emerald-500/10' };
  if (source.publicationStatus === 'archived') return { label: 'Arşivde', tone: 'text-theme-text-muted bg-theme-surface' };
  return { label: 'Taslak', tone: 'text-theme-text-muted bg-theme-surface' };
};

const reviewLabel: Record<KnowledgeReviewItem['reviewType'], string> = {
  possible_duplicate: 'Olası tekrar',
  possible_conflict: 'Olası çelişki',
  low_confidence_relation: 'Düşük güvenli ilişki',
  synthetic_endpoint: 'Eksik graph nesnesi',
  source_version_candidate: 'Kaynak sürüm eşleştirmesi',
};

const SourceGlyph = ({ source, size = 'md' }: { source: KnowledgeSourceSummary; size?: 'sm' | 'md' | 'lg' }) => {
  const kind = fileType(source);
  const Icon = kind === 'image' ? ImageIcon : kind === 'table' ? FileSpreadsheet : FileText;
  const box = size === 'lg' ? 'h-16 w-16 rounded-2xl' : size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl';
  const iconSize = size === 'lg' ? 28 : size === 'sm' ? 15 : 18;
  return (
    <div className={`grid ${box} shrink-0 place-items-center border border-theme-border/70 bg-theme-surface text-theme-text-muted`}>
      <Icon size={iconSize} />
    </div>
  );
};

export function KnowledgeBankModal({ workspaceId, onClose }: Props) {
  const [scope, setScope] = useState<KnowledgeScope>('global');
  const [section, setSection] = useState<LibrarySection>('all');
  const [hasProjectScope, setHasProjectScope] = useState(false);
  const [sources, setSources] = useState<KnowledgeSourceSummary[]>([]);
  const [versions, setVersions] = useState<KnowledgeSourceVersion[]>([]);
  const [reviewItems, setReviewItems] = useState<KnowledgeReviewItem[]>([]);
  const [health, setHealth] = useState<KnowledgeGraphHealth>(emptyHealth);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveKnowledgeContext(workspaceId)
      .then(context => {
        if (!cancelled) setHasProjectScope(Boolean(context.projectSpaceId));
      })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'JetBase kapsamı çözümlenemedi.');
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSources, nextHealth, nextReviewItems, nextVersions] = await Promise.all([
        listKnowledgeSources(workspaceId, scope),
        getKnowledgeGraphHealth(workspaceId, scope),
        listKnowledgeReviewItems(workspaceId, scope),
        listKnowledgeSourceVersions(workspaceId, scope),
      ]);
      setSources(nextSources);
      setHealth(nextHealth);
      setReviewItems(nextReviewItems);
      setVersions(nextVersions);
      setSelectedSourceId(current => current && nextSources.some(source => source.id === current)
        ? current
        : nextSources[0]?.id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JetBase verileri okunamadı.');
    } finally {
      setLoading(false);
    }
  }, [scope, workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) await ingestKnowledgeFile(workspaceId, file, scope);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JetBase kaynağı yüklenemedi.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
      setError(e instanceof Error ? e.message : 'Kaynak güncellenemedi.');
    } finally {
      setBusyId(null);
    }
  };

  const visibleSources = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    let next = sources.filter(source => !normalized || [source.name, source.documentType, fileTypeLabel(source)]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('tr-TR')
      .includes(normalized));
    if (section === 'images') next = next.filter(source => fileType(source) === 'image');
    if (section === 'documents') next = next.filter(source => fileType(source) === 'document');
    if (section === 'tables') next = next.filter(source => fileType(source) === 'table');
    if (section === 'recent') next = next.slice(0, 12);
    return next;
  }, [query, section, sources]);

  const selectedSource = sources.find(source => source.id === selectedSourceId) || null;
  const selectedVersions = useMemo(() => selectedSource
    ? versions.filter(version => version.sourceId === selectedSource.id)
    : [], [selectedSource, versions]);

  const counts = useMemo(() => ({
    all: sources.length,
    recent: Math.min(sources.length, 12),
    images: sources.filter(source => fileType(source) === 'image').length,
    documents: sources.filter(source => fileType(source) === 'document').length,
    tables: sources.filter(source => fileType(source) === 'table').length,
  }), [sources]);

  const navItems = [
    { id: 'all' as const, label: 'Tüm Kaynaklar', icon: Database, count: counts.all },
    { id: 'recent' as const, label: 'Son Eklenenler', icon: Clock3, count: counts.recent },
    { id: 'images' as const, label: 'Görseller', icon: ImageIcon, count: counts.images },
    { id: 'documents' as const, label: 'Dokümanlar', icon: FileText, count: counts.documents },
    { id: 'tables' as const, label: 'Tablolar', icon: FileSpreadsheet, count: counts.tables },
  ];

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-theme-bg text-theme-text"
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-4 z-50 grid place-items-center rounded-3xl border-2 border-dashed border-theme-primary bg-theme-primary/5 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-theme-border bg-theme-bg px-8 py-7 shadow-2xl">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-theme-primary/10 text-theme-primary"><Upload size={22} /></div>
            <div className="text-center"><p className="font-semibold">JetBase'e bırak</p><p className="mt-1 text-xs text-theme-text-muted">Dosyalar yüklenip AI ile anlamlandırılacak</p></div>
          </div>
        </div>
      )}

      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-theme-border px-5 lg:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-theme-text text-theme-bg"><Database size={17} /></div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">JetBase</h1>
            <p className="hidden text-[11px] text-theme-text-muted sm:block">Kurumsal bilgi çalışma alanı</p>
          </div>
        </div>

        {section !== 'admin' && (
          <div className="relative mx-auto hidden w-full max-w-xl md:block">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="JetBase'te ara..."
              className="h-9 w-full rounded-xl border border-theme-border bg-theme-surface/70 pl-9 pr-3 text-sm outline-none transition focus:border-theme-text/30 focus:bg-theme-bg"
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.csv,.tsv,.html,.htm,.json,.xml,.svg,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.heic,.heif,image/*"
            className="hidden"
            onChange={event => void uploadFiles(Array.from(event.target.files || []))}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-theme-text px-3.5 text-xs font-semibold text-theme-bg transition hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            <span className="hidden sm:inline">Kaynak Ekle</span>
          </button>
          <button type="button" onClick={() => void refresh()} className="grid h-9 w-9 place-items-center rounded-xl text-theme-text-muted hover:bg-theme-surface hover:text-theme-text" title="Yenile">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-theme-text-muted hover:bg-theme-surface hover:text-theme-text" aria-label="JetBase'i kapat">
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[220px] shrink-0 flex-col border-r border-theme-border px-3 py-4 md:flex">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-theme-text-muted">Kütüphane</div>
          <nav className="space-y-0.5">
            {navItems.map(item => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition ${active ? 'bg-theme-surface font-semibold text-theme-text' : 'text-theme-text-muted hover:bg-theme-surface/70 hover:text-theme-text'}`}>
                  <Icon size={15} /><span className="flex-1">{item.label}</span><span className="text-[10px] tabular-nums opacity-70">{item.count}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-theme-text-muted">Kapsam</div>
          <div className="space-y-0.5">
            <button type="button" onClick={() => setScope('global')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${scope === 'global' ? 'bg-theme-surface font-semibold' : 'text-theme-text-muted hover:bg-theme-surface/70'}`}>
              <Globe2 size={15} /> Global JetBase
            </button>
            {hasProjectScope && (
              <button type="button" onClick={() => setScope('project')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${scope === 'project' ? 'bg-theme-surface font-semibold' : 'text-theme-text-muted hover:bg-theme-surface/70'}`}>
                <FolderKanban size={15} /> Proje JetBase
              </button>
            )}
          </div>

          <div className="mt-auto border-t border-theme-border pt-3">
            <button type="button" onClick={() => setSection('admin')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${section === 'admin' ? 'bg-theme-surface font-semibold' : 'text-theme-text-muted hover:bg-theme-surface/70 hover:text-theme-text'}`}>
              <Settings2 size={15} /> Yönetim
              {health.openReviewCount > 0 && <span className="ml-auto rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">{health.openReviewCount}</span>}
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-theme-border px-5 py-4 lg:px-7">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold tracking-tight">
                  {section === 'admin' ? 'JetBase Yönetimi' : navItems.find(item => item.id === section)?.label || 'Kaynaklar'}
                </h2>
                <p className="mt-0.5 text-xs text-theme-text-muted">
                  {section === 'admin'
                    ? 'Kalite ve graph kontrolleri normal çalışma alanından ayrı tutulur.'
                    : `${scope === 'global' ? 'Global' : 'Proje'} kapsamı · ${visibleSources.length} kaynak`}
                </p>
              </div>
              <div className="flex items-center gap-2 md:hidden">
                {hasProjectScope && (
                  <select value={scope} onChange={event => setScope(event.target.value as KnowledgeScope)} className="rounded-lg border border-theme-border bg-theme-surface px-2 py-1.5 text-xs">
                    <option value="global">Global</option><option value="project">Proje</option>
                  </select>
                )}
                <select value={section} onChange={event => setSection(event.target.value as LibrarySection)} className="rounded-lg border border-theme-border bg-theme-surface px-2 py-1.5 text-xs">
                  <option value="all">Tüm Kaynaklar</option><option value="recent">Son Eklenenler</option><option value="images">Görseller</option><option value="documents">Dokümanlar</option><option value="tables">Tablolar</option><option value="admin">Yönetim</option>
                </select>
              </div>
            </div>
            {section !== 'admin' && (
              <div className="relative mt-3 md:hidden">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="JetBase'te ara..." className="h-9 w-full rounded-xl border border-theme-border bg-theme-surface pl-9 pr-3 text-sm outline-none" />
              </div>
            )}
          </div>

          {error && <div className="mx-5 mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600 lg:mx-7"><AlertCircle size={15} />{error}</div>}

          {section === 'admin' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-7">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-theme-border bg-theme-surface/40 p-4"><p className="text-xs text-theme-text-muted">İndekslenen nesne</p><p className="mt-2 text-2xl font-semibold">{health.objectCount}</p></div>
                <div className="rounded-2xl border border-theme-border bg-theme-surface/40 p-4"><p className="text-xs text-theme-text-muted">Açık inceleme</p><p className="mt-2 text-2xl font-semibold">{health.openReviewCount}</p></div>
                <div className="rounded-2xl border border-theme-border bg-theme-surface/40 p-4"><p className="text-xs text-theme-text-muted">Graph bütünlüğü</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold">{health.danglingRelationCount === 0 ? <><ShieldCheck size={17} className="text-emerald-600" /> Sağlıklı</> : <><AlertCircle size={17} className="text-amber-600" /> İnceleme gerekli</>}</p></div>
              </div>
              <div className="mt-6">
                <h3 className="text-sm font-semibold">İnceleme kuyruğu</h3>
                <p className="mt-1 text-xs text-theme-text-muted">Yalnızca veri yöneticisinin müdahale etmesi gereken kayıtlar.</p>
                <div className="mt-3 space-y-2">
                  {reviewItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-theme-border p-8 text-center text-sm text-theme-text-muted">Açık inceleme yok.</div>
                  ) : reviewItems.map(item => (
                    <div key={item.id} className="rounded-xl border border-theme-border px-4 py-3">
                      <div className="flex items-center gap-2"><span className="text-xs font-semibold">{reviewLabel[item.reviewType]}</span>{item.confidence != null && <span className="text-[10px] text-theme-text-muted">%{Math.round(item.confidence * 100)} güven</span>}</div>
                      <p className="mt-1 truncate text-xs text-theme-text-muted">{item.canonicalKey || item.relatedCanonicalKey || 'Kaynak eşleştirmesi'}</p>
                    </div>
                  ))}
                </div>
              </div>
              <details className="mt-6 rounded-xl border border-theme-border px-4 py-3 text-xs text-theme-text-muted">
                <summary className="cursor-pointer font-medium text-theme-text">Teknik graph ayrıntıları</summary>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"><span>İlişki: {health.activeRelationCount}</span><span>Sentetik: {health.syntheticObjectCount}</span><span>Dangling: {health.danglingRelationCount}</span></div>
              </details>
            </div>
          ) : loading && sources.length === 0 ? (
            <div className="grid min-h-0 flex-1 place-items-center"><div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={17} className="animate-spin" />JetBase hazırlanıyor…</div></div>
          ) : visibleSources.length === 0 ? (
            <div className="grid min-h-0 flex-1 place-items-center p-6">
              <div className="w-full max-w-lg rounded-3xl border border-dashed border-theme-border px-6 py-10 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-theme-surface text-theme-text-muted"><Upload size={22} /></div>
                <h3 className="mt-4 text-sm font-semibold">{query ? 'Eşleşen kaynak bulunamadı' : 'JetBase’i kaynaklarla besleyin'}</h3>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-theme-text-muted">Image, PDF, Word, Excel, TXT ve Markdown dosyaları yüklenebilir. Görseller AI ile anlamlandırılır, orijinal dosya korunur.</p>
                {!query && <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-theme-text px-4 py-2 text-xs font-semibold text-theme-bg"><Upload size={14} />Dosya seç</button>}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-5 lg:px-7">
              <div className="hidden grid-cols-[minmax(0,1fr)_110px_100px_105px] gap-4 border-b border-theme-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-theme-text-muted lg:grid">
                <span>Kaynak</span><span>Tür</span><span>Durum</span><span>Güncelleme</span>
              </div>
              <div className="divide-y divide-theme-border/70">
                {visibleSources.map(source => {
                  const status = sourceStatus(source);
                  const selected = source.id === selectedSourceId;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => setSelectedSourceId(source.id)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left transition lg:grid-cols-[minmax(0,1fr)_110px_100px_105px] lg:gap-4 ${selected ? 'bg-theme-surface/80' : 'hover:bg-theme-surface/45'}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <SourceGlyph source={source} />
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{source.name}</p><p className="mt-0.5 truncate text-[11px] text-theme-text-muted">v{source.latestVersion}{source.multimodal?.visionApplied ? ' · AI analizli' : ''}</p></div>
                      </div>
                      <span className="hidden text-xs text-theme-text-muted lg:block">{fileTypeLabel(source)}</span>
                      <span className={`hidden w-fit rounded-full px-2 py-1 text-[10px] font-semibold lg:block ${status.tone}`}>{status.label}</span>
                      <span className="hidden text-[11px] text-theme-text-muted lg:block">{formatDate(source.updatedAt)}</span>
                      <span className="lg:hidden"><MoreHorizontal size={16} className="text-theme-text-muted" /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        {section !== 'admin' && selectedSource && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-theme-border xl:block">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <SourceGlyph source={selectedSource} size="lg" />
                <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold leading-5">{selectedSource.name}</p><p className="mt-1 text-xs text-theme-text-muted">{fileTypeLabel(selectedSource)} · {scope === 'global' ? 'Global' : 'Proje'} JetBase</p></div>
              </div>

              <div className="mt-5 rounded-2xl border border-theme-border bg-theme-surface/40 p-4">
                <div className="flex items-center gap-2"><Sparkles size={15} className="text-theme-primary" /><h3 className="text-xs font-semibold">AI Anlayışı</h3></div>
                <p className="mt-2 text-xs leading-relaxed text-theme-text-muted">
                  {selectedSource.multimodal?.visionApplied
                    ? 'Görsel içerik AI ile analiz edildi ve aranabilir bağlama dönüştürüldü.'
                    : 'Kaynağın yapısal içeriği ayrıştırıldı ve JetBase aramasına hazırlandı.'}
                </p>
                {selectedSource.multimodal?.embeddedImagesDetected ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-theme-bg px-3 py-2 text-[11px] text-theme-text-muted"><ImageIcon size={13} />{selectedSource.multimodal.embeddedImagesDescribed}/{selectedSource.multimodal.embeddedImagesDetected} gömülü görsel anlamlandırıldı</div>
                ) : null}
                {selectedSource.multimodal?.originalBinaryPreserved && <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-600"><Check size={13} />Orijinal dosya korundu</div>}
              </div>

              <div className="mt-5">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-theme-text-muted">Kaynak bilgisi</h3>
                <div className="mt-2 divide-y divide-theme-border/70 rounded-xl border border-theme-border">
                  <div className="flex items-center justify-between px-3 py-2.5 text-xs"><span className="text-theme-text-muted">Durum</span><span>{sourceStatus(selectedSource).label}</span></div>
                  <div className="flex items-center justify-between px-3 py-2.5 text-xs"><span className="text-theme-text-muted">Sürüm</span><span>v{selectedSource.latestVersion}</span></div>
                  <div className="flex items-center justify-between px-3 py-2.5 text-xs"><span className="text-theme-text-muted">İndekslenen bölüm</span><span>{selectedSource.objectCount}</span></div>
                  <div className="flex items-center justify-between px-3 py-2.5 text-xs"><span className="text-theme-text-muted">Güncellendi</span><span>{formatDate(selectedSource.updatedAt)}</span></div>
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center gap-2"><History size={14} className="text-theme-text-muted" /><h3 className="text-xs font-semibold">Sürümler</h3></div>
                <div className="mt-2 space-y-1.5">
                  {selectedVersions.length === 0 ? <p className="text-xs text-theme-text-muted">Sürüm kaydı bulunamadı.</p> : selectedVersions.slice(0, 5).map(version => (
                    <div key={version.sourceVersionId} className="flex items-center justify-between rounded-lg bg-theme-surface/60 px-3 py-2 text-xs"><span>v{version.versionNumber}</span><span className="text-[10px] text-theme-text-muted">{formatDate(version.createdAt)}</span></div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2 border-t border-theme-border pt-4">
                {selectedSource.publicationStatus !== 'published' && selectedSource.ingestionStatus === 'ready' && (
                  <button type="button" disabled={busyId === selectedSource.id} onClick={() => void act(selectedSource, 'publish')} className="inline-flex items-center gap-1.5 rounded-lg bg-theme-text px-3 py-2 text-xs font-semibold text-theme-bg disabled:opacity-50"><RotateCcw size={13} />Yayınla</button>
                )}
                {selectedSource.publicationStatus !== 'archived' && <button type="button" disabled={busyId === selectedSource.id} onClick={() => void act(selectedSource, 'archive')} className="inline-flex items-center gap-1.5 rounded-lg border border-theme-border px-3 py-2 text-xs text-theme-text-muted hover:text-theme-text"><Archive size={13} />Arşivle</button>}
                {confirmDeleteId === selectedSource.id ? (
                  <><button type="button" disabled={busyId === selectedSource.id} onClick={() => void act(selectedSource, 'delete')} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white">Kalıcı sil</button><button type="button" onClick={() => setConfirmDeleteId(null)} className="px-2 py-2 text-xs text-theme-text-muted">Vazgeç</button></>
                ) : <button type="button" onClick={() => setConfirmDeleteId(selectedSource.id)} className="grid h-8 w-8 place-items-center rounded-lg text-theme-text-muted hover:bg-red-500/10 hover:text-red-600" title="Kalıcı sil"><Trash2 size={14} /></button>}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
