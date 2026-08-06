import React, { useMemo, useState } from 'react';
import {
  Bot,
  GitCompareArrows,
  History,
  Loader2,
  RotateCcw,
  UserRound,
  X,
} from 'lucide-react';
import type { DocumentData } from '../types';
import type { DocumentVersionRecord } from '../services/documentVersionRepository';
import { cn } from '../lib/utils';
import { DiffViewerModal } from './DiffViewerModal';

interface DocumentVersionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  versions: DocumentVersionRecord[];
  currentVersionId: string | null;
  currentDocument: DocumentData | null;
  isLoading?: boolean;
  isRestoring?: boolean;
  error?: string | null;
  onRefresh: () => Promise<unknown>;
  onRestore: (version: DocumentVersionRecord) => Promise<void>;
}

const sourceLabel: Record<DocumentVersionRecord['changeSource'], string> = {
  AI: 'AI',
  MANUAL: 'Manuel',
  RESTORE: 'Geri yükleme',
  TEMPLATE: 'Şablon',
  IMPORT: 'İçe aktarma',
  SYSTEM: 'Sistem',
};

function VersionSourceIcon({ source }: { source: DocumentVersionRecord['changeSource'] }) {
  if (source === 'AI') return <Bot size={15} />;
  return <UserRound size={15} />;
}

export function DocumentVersionHistory({
  isOpen,
  onClose,
  versions,
  currentVersionId,
  currentDocument,
  isLoading = false,
  isRestoring = false,
  error,
  onRefresh,
  onRestore,
}: DocumentVersionHistoryProps) {
  const [compareVersion, setCompareVersion] = useState<DocumentVersionRecord | null>(null);

  const sortedVersions = useMemo(
    () => [...versions].sort((left, right) => right.versionNumber - left.versionNumber),
    [versions],
  );

  if (!isOpen) return null;

  const handleRestore = async (version: DocumentVersionRecord) => {
    const accepted = window.confirm(
      `v${version.versionNumber} içeriği yeni bir sürüm olarak geri yüklenecek. Devam edilsin mi?`,
    );
    if (!accepted) return;

    await onRestore(version);
    setCompareVersion(null);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) onClose();
        }}
      >
        <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-theme-border bg-theme-bg shadow-2xl">
          <header className="flex items-center justify-between border-b border-theme-border bg-theme-surface px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-theme-primary/10 text-theme-primary">
                <History size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-theme-text">Doküman Versiyon Geçmişi</h2>
                <p className="text-xs text-theme-text-muted">
                  Geçmiş sürümleri karşılaştırın veya yeni bir sürüm olarak geri yükleyin.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onRefresh()}
                disabled={isLoading}
                className="inline-flex items-center gap-2 rounded-md border border-theme-border px-3 py-2 text-xs font-medium text-theme-text hover:bg-theme-surface-hover disabled:opacity-50"
              >
                <RotateCcw size={14} className={cn(isLoading && 'animate-spin')} />
                Yenile
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-md text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text"
                aria-label="Kapat"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-5">
            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {isLoading && sortedVersions.length === 0 ? (
              <div className="flex min-h-60 items-center justify-center gap-3 text-theme-text-muted">
                <Loader2 size={20} className="animate-spin" />
                Versiyonlar yükleniyor...
              </div>
            ) : sortedVersions.length === 0 ? (
              <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-theme-border text-center">
                <History size={28} className="mb-3 text-theme-text-muted" />
                <p className="text-sm font-medium text-theme-text">Henüz kayıtlı sürüm yok.</p>
                <p className="mt-1 text-xs text-theme-text-muted">
                  İlk manuel veya AI doküman kaydından sonra geçmiş burada görünecek.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-theme-border">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-theme-surface text-[11px] uppercase tracking-wider text-theme-text-muted">
                    <tr>
                      <th className="px-4 py-3">Sürüm</th>
                      <th className="px-4 py-3">Kaynak</th>
                      <th className="px-4 py-3">Değişiklik</th>
                      <th className="px-4 py-3">Tarih</th>
                      <th className="px-4 py-3 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedVersions.map((version) => {
                      const isCurrent = version.id === currentVersionId;
                      return (
                        <tr key={version.id} className="border-t border-theme-border align-top">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-theme-text">v{version.versionNumber}</span>
                              {isCurrent && (
                                <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-green-600">
                                  Aktif
                                </span>
                              )}
                            </div>
                            {version.changedSections.length > 0 && (
                              <p className="mt-1 max-w-44 text-[11px] text-theme-text-muted">
                                {version.changedSections.join(', ')}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <div className="inline-flex items-center gap-2 rounded-full border border-theme-border bg-theme-surface px-2.5 py-1 text-xs text-theme-text">
                              <VersionSourceIcon source={version.changeSource} />
                              {sourceLabel[version.changeSource]}
                            </div>
                            {(version.provider || version.model) && (
                              <p className="mt-1 text-[11px] text-theme-text-muted">
                                {[version.provider, version.model].filter(Boolean).join(' / ')}
                              </p>
                            )}
                          </td>
                          <td className="max-w-md px-4 py-4">
                            <p className="font-medium text-theme-text">{version.changeSummary}</p>
                            {version.sourceMessageId && (
                              <p className="mt-1 truncate font-mono text-[10px] text-theme-text-muted" title={version.sourceMessageId}>
                                Kaynak: {version.sourceMessageId}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-xs text-theme-text-muted">
                            {new Date(version.createdAt).toLocaleString('tr-TR', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setCompareVersion(version)}
                                disabled={!currentDocument}
                                className="inline-flex items-center gap-1.5 rounded-md border border-theme-border px-2.5 py-1.5 text-xs font-medium text-theme-text hover:bg-theme-surface-hover disabled:opacity-40"
                              >
                                <GitCompareArrows size={13} />
                                Karşılaştır
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRestore(version)}
                                disabled={isCurrent || isRestoring}
                                className="inline-flex items-center gap-1.5 rounded-md bg-theme-primary px-2.5 py-1.5 text-xs font-semibold text-theme-primary-fg hover:bg-theme-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {isRestoring ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                                Geri Yükle
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {compareVersion && currentDocument && (
        <DiffViewerModal
          oldDoc={compareVersion.content}
          newDoc={currentDocument}
          onClose={() => setCompareVersion(null)}
          onRestore={() => void handleRestore(compareVersion)}
        />
      )}
    </>
  );
}
