import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  KnowledgeSourceSummary,
  listKnowledgeSources,
  publishKnowledgeSource,
} from '../services/knowledgeCatalogRepository';

interface KnowledgeBankModalProps {
  workspaceId: string;
  onClose: () => void;
}

const statusLabel = (source: KnowledgeSourceSummary) => {
  if (source.ingestionStatus === 'failed') return 'İşleme hatası';
  if (source.ingestionStatus !== 'ready') return 'İşleniyor';
  if (source.publicationStatus === 'published') return 'Yayında';
  if (source.publicationStatus === 'archived') return 'Arşivde';
  return 'İnceleme bekliyor';
};

export function KnowledgeBankModal({
  workspaceId,
  onClose,
}: KnowledgeBankModalProps) {
  const [sources, setSources] = useState<KnowledgeSourceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSources(await listKnowledgeSources(workspaceId));
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Bilgi bankası okunamadı.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const publish = async (sourceId: string) => {
    setPublishingId(sourceId);
    setError(null);
    try {
      await publishKnowledgeSource(sourceId);
      await refresh();
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : 'Kaynak yayımlanamadı.',
      );
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-theme-border bg-theme-bg shadow-2xl">
        <div className="flex items-center gap-3 border-b border-theme-border px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-theme-primary/10 text-theme-primary">
            <Database size={20} />
          </div>
          <div>
            <h2 className="font-semibold text-theme-text">Bilgi Bankası</h2>
            <p className="text-xs text-theme-text-muted">
              Hesabındaki tüm proje ve sohbetlerde kullanılan ortak TXT ve MD kaynakları.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto rounded-lg p-2 text-theme-text-muted hover:bg-theme-surface hover:text-theme-text"
            title="Yenile"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-theme-text-muted hover:bg-theme-surface hover:text-theme-text"
            aria-label="Bilgi bankasını kapat"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isLoading && sources.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-theme-text-muted">
              <Loader2 size={18} className="animate-spin" />
              Kaynaklar okunuyor…
            </div>
          ) : sources.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-theme-border text-center">
              <FileText size={28} className="mb-3 text-theme-text-muted" />
              <p className="text-sm font-medium text-theme-text">Henüz kalıcı kaynak yok</p>
              <p className="mt-1 max-w-md text-xs text-theme-text-muted">
                Herhangi bir sohbete TXT veya MD dosyası ekle ve “Bilgi bankası” seçeneğini açık bırak.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sources.map(source => {
                const isPublished = source.publicationStatus === 'published';
                const canPublish = source.ingestionStatus === 'ready'
                  && source.publicationStatus === 'draft';
                return (
                  <div
                    key={source.id}
                    className="rounded-xl border border-theme-border bg-theme-surface/50 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <FileText size={18} className="mt-0.5 shrink-0 text-theme-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-theme-text">
                            {source.name}
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isPublished
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : 'bg-amber-500/10 text-amber-600'
                          }`}>
                            {statusLabel(source)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-theme-text-muted">
                          v{source.latestVersion} · {source.objectCount} nesne · {source.relationCount} ilişki
                          {source.documentType ? ` · ${source.documentType}` : ''}
                        </p>
                      </div>

                      {isPublished ? (
                        <div className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 size={15} />
                          AI kullanabilir
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!canPublish || publishingId === source.id}
                          onClick={() => void publish(source.id)}
                          className="rounded-lg bg-theme-primary px-3 py-1.5 text-xs font-semibold text-theme-primary-fg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {publishingId === source.id ? 'Yayımlanıyor…' : 'Yayımla'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
