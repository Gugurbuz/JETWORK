import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Database, Files, Globe2, Image as ImageIcon, Loader2, X } from 'lucide-react';
import type { Message, MessageAttachment } from '../../types';
import { cn } from '../../lib/utils';
import { splitAssistantSources } from '../../services/assistantSources';
import { listWorkspaceFiles, type WorkspaceFileRecord } from '../../services/workspaceFileRepository';
import { GeneratedFileCard } from '../artifacts/GeneratedFileCard';
import { ArtifactStatusBadge } from '../artifacts/ArtifactStatusBadge';

type WorkspacePanelTab = 'files' | 'sources' | 'work';

interface WorkspaceRightPanelProps {
  workspaceId: string;
  messages: Message[];
  legacyFiles: MessageAttachment[];
  refreshKey?: number;
  onOpenFile: (file: MessageAttachment) => void;
  onClose: () => void;
  initialTab?: WorkspacePanelTab;
}

const artifactTool = /(?:create_document_file|edit_office_file|transform_pdf_file|generate_or_edit_image|create_spreadsheet_file|edit_spreadsheet_file|transform_spreadsheet_file|sync_spreadsheet_with_jira_export|dosya|word|excel|powerpoint|spreadsheet|artifact)/iu;

const fileKey = (file: MessageAttachment) => file.attachmentId || file.storagePath || file.name || crypto.randomUUID();

export function WorkspaceRightPanel({
  workspaceId,
  messages,
  legacyFiles,
  refreshKey = 0,
  onOpenFile,
  onClose,
  initialTab = 'files',
}: WorkspaceRightPanelProps) {
  const [tab, setTab] = useState<WorkspacePanelTab>(initialTab);
  const [files, setFiles] = useState<WorkspaceFileRecord[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    let cancelled = false;
    setLoadingFiles(true);
    void listWorkspaceFiles({ workspaceId, origin: 'generated', sort: 'newest', limit: 200 })
      .then(records => {
        if (!cancelled) setFiles(records);
      })
      .catch(error => {
        console.warn('Canonical workspace files unavailable; using message attachments.', error);
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId, refreshKey]);

  const displayFiles = files.length > 0 ? files : legacyFiles;

  const artifactGroups = useMemo(() => {
    const groups = new Map<string, MessageAttachment[]>();
    displayFiles.forEach(file => {
      const record = file as WorkspaceFileRecord;
      const key = record.artifactId || `legacy:${fileKey(file)}`;
      const existing = groups.get(key) || [];
      existing.push(file);
      groups.set(key, existing);
    });
    return [...groups.entries()].map(([id, versions]) => ({
      id,
      versions: versions.sort((a, b) => Number((b as WorkspaceFileRecord).artifactVersion || 0) - Number((a as WorkspaceFileRecord).artifactVersion || 0)),
    }));
  }, [displayFiles]);

  const sourceView = useMemo(() => {
    const knowledge = new Map<string, ReturnType<typeof splitAssistantSources>['knowledgeSources'][number]>();
    const media = new Map<string, ReturnType<typeof splitAssistantSources>['mediaSources'][number]>();
    const web = new Map<string, { uri: string; title: string }>();
    messages.forEach(message => {
      const split = splitAssistantSources(message.knowledgeSources || [], message.groundingUrls || []);
      split.knowledgeSources.forEach(source => knowledge.set(source.sourceId || source.canonicalKey || source.sourceName, source));
      split.mediaSources.forEach(source => media.set(source.sourceId || source.contentHash || source.sourceName, source));
      split.groundingUrls.forEach(source => web.set(source.uri, source));
    });
    return { knowledge: [...knowledge.values()], media: [...media.values()], web: [...web.values()] };
  }, [messages]);

  const workEvents = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'model' && messages[index].workEvents?.length) {
        return [...(messages[index].workEvents || [])].sort((a, b) => a.sequence - b.sequence);
      }
    }
    return [];
  }, [messages]);

  const activeArtifactEvent = [...workEvents].reverse().find(event =>
    event.state === 'active' && (event.kind === 'artifact' || artifactTool.test(`${event.tool || ''} ${event.label}`)),
  );
  const sourceCount = sourceView.knowledge.length + sourceView.media.length + sourceView.web.length;

  const tabs: Array<{ id: WorkspacePanelTab; label: string; count?: number }> = [
    { id: 'files', label: 'Dosyalar', count: artifactGroups.length },
    { id: 'sources', label: 'Kaynaklar', count: sourceCount },
    { id: 'work', label: 'Agent Work', count: workEvents.length },
  ];

  return (
    <aside id="workspace-right-panel" data-testid="workspace-right-panel" className="workspace-right-panel" aria-label="Çalışma alanı paneli">
      <header className="workspace-right-panel__header">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={16} className="text-theme-text-muted" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-theme-text">Çalışma alanı</h2>
            <p className="text-[10px] text-theme-text-muted">Dosyalar, kaynaklar ve çalışma durumu</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="workspace-right-panel__close" aria-label="Çalışma alanını kapat"><X size={16} /></button>
      </header>

      <nav className="workspace-right-panel__tabs" aria-label="Çalışma alanı bölümleri">
        {tabs.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn('workspace-right-panel__tab', tab === item.id && 'workspace-right-panel__tab--active')}
            aria-selected={tab === item.id}
          >
            {item.label}{item.count !== undefined && item.count > 0 ? <span>{item.count}</span> : null}
          </button>
        ))}
      </nav>

      <div className="workspace-right-panel__body">
        {tab === 'files' && (
          <div className="space-y-3">
            {activeArtifactEvent && (
              <div className="rounded-2xl border border-theme-border bg-theme-surface/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-theme-text">
                    <Loader2 size={14} className="animate-spin text-theme-text-muted" />
                    <span className="truncate">{activeArtifactEvent.label}</span>
                  </div>
                  <ArtifactStatusBadge state="executing" />
                </div>
                <p className="mt-1 text-[10px] text-theme-text-muted">Gerçek runtime tool eventinden gösteriliyor.</p>
              </div>
            )}
            {loadingFiles && displayFiles.length === 0 && (
              <div className="flex items-center gap-2 py-8 text-xs text-theme-text-muted"><Loader2 size={14} className="animate-spin" /> Dosyalar yükleniyor…</div>
            )}
            {!loadingFiles && artifactGroups.length === 0 && !activeArtifactEvent && (
              <div className="py-8 text-center text-xs text-theme-text-muted">Bu sohbette henüz üretilmiş dosya yok.</div>
            )}
            {artifactGroups.map(group => {
              const active = group.versions[0];
              return (
                <div key={group.id} className="rounded-2xl border border-theme-border/60 bg-theme-surface/20 p-2">
                  <GeneratedFileCard file={active} onOpen={onOpenFile} showDownload={false} className="border-0 bg-transparent shadow-none" />
                  {group.versions.length > 1 && (
                    <div className="flex flex-wrap gap-1.5 border-t border-theme-border/50 px-2 pt-2">
                      {group.versions.map((version, index) => {
                        const number = (version as WorkspaceFileRecord).artifactVersion || group.versions.length - index;
                        return (
                          <button key={fileKey(version)} type="button" onClick={() => onOpenFile(version)} className={cn('rounded-lg border px-2 py-1 text-[10px]', index === 0 ? 'border-theme-text-muted/30 bg-theme-bg font-semibold text-theme-text' : 'border-theme-border text-theme-text-muted hover:text-theme-text')}>
                            v{number}{index === 0 ? ' · Aktif' : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'sources' && (
          <div className="space-y-4">
            {sourceCount === 0 && <div className="py-8 text-center text-xs text-theme-text-muted">Bu sohbette görünür kaynak yok.</div>}
            {sourceView.web.length > 0 && <section><h3 className="workspace-panel-section-title"><Globe2 size={12} /> Web</h3><div className="space-y-1.5">{sourceView.web.map(source => <a key={source.uri} href={source.uri} target="_blank" rel="noopener noreferrer" className="workspace-source-card"><span className="truncate">{source.title}</span></a>)}</div></section>}
            {sourceView.knowledge.length > 0 && <section><h3 className="workspace-panel-section-title"><Database size={12} /> Kurumsal kaynaklar</h3><div className="space-y-1.5">{sourceView.knowledge.map(source => <div key={source.sourceId || source.canonicalKey || source.sourceName} className="workspace-source-card"><span className="truncate font-medium text-theme-text">{source.title || source.sourceName}</span><span className="block truncate text-[9px]">{source.sourceName}</span></div>)}</div></section>}
            {sourceView.media.length > 0 && <section><h3 className="workspace-panel-section-title"><ImageIcon size={12} /> Medya</h3><div className="space-y-1.5">{sourceView.media.map(source => <div key={source.sourceId || source.contentHash || source.sourceName} className="workspace-source-card"><span className="truncate">{source.title || source.sourceName}</span></div>)}</div></section>}
          </div>
        )}

        {tab === 'work' && (
          <div className="space-y-2">
            {workEvents.length === 0 && <div className="py-8 text-center text-xs text-theme-text-muted">Bu tur için Agent Work kaydı yok.</div>}
            {workEvents.map(event => (
              <div key={event.eventId} className="flex gap-2 rounded-xl border border-theme-border/60 bg-theme-surface/30 p-2.5">
                <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', event.state === 'failed' ? 'bg-red-500' : event.state === 'active' ? 'bg-theme-text-muted animate-pulse' : 'bg-emerald-500')} />
                <div className="min-w-0 flex-1"><div className="text-[11px] font-medium text-theme-text">{event.label}</div><div className="mt-0.5 text-[9px] uppercase tracking-wide text-theme-text-muted">{event.tool || event.kind} · #{event.sequence}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
