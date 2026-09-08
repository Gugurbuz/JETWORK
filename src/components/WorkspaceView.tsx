import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Files,
  Image as ImageIcon,
  Menu,
  Presentation,
  X,
} from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import { FileViewer } from './FileViewer';
import { CompactModelControl } from './CompactModelControl';
import type { Message, DocumentData, MessageAttachment, MessageSendOptions } from '../types';
import type { User } from '../hooks/useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useUIStore } from '../store/useUIStore';
import { useMessageStore } from '../store/useMessageStore';
import { cn } from '../lib/utils';
import '../jetwork-conversation-shell.css';
import '../workspace-file-panel.css';

interface WorkspaceViewProps {
  messages: Message[];
  user: User;
  latestScore?: number;
  latestScoreExplanation?: string;
  channelRef: React.MutableRefObject<any>;
  sessionId: React.MutableRefObject<string>;
  onSendMessage: (
    text: string,
    attachments?: MessageAttachment[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  onStopGeneration: () => void;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onToggleAiActive: () => void;
  onToggleZeroTouchMode: () => void;
  onAcceptAiHandRaise: () => void;
  onDismissAiHandRaise: () => void;
  onRestoreDocument: (content: DocumentData) => Promise<void>;
  onGenerateDocument: () => Promise<void>;
  onUpdateDocument: (content: DocumentData) => Promise<void>;
}

type GeneratedFileKind = 'word' | 'excel' | 'powerpoint' | 'pdf' | 'image' | 'file';

interface GeneratedFileVisual {
  kind: GeneratedFileKind;
  label: string;
  icon: React.ReactNode;
  tileClass: string;
}

const extensionOf = (name?: string) => String(name || '').split('.').pop()?.toLocaleLowerCase('en-US') || '';

const generatedFileVisual = (file: MessageAttachment): GeneratedFileVisual => {
  const ext = extensionOf(file.name);
  const mime = String(file.mimeType || '');
  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    return {
      kind: 'word',
      label: 'Word belgesi',
      icon: <FileText size={17} />,
      tileClass: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400',
    };
  }
  if (ext === 'xlsx' || mime.includes('spreadsheet')) {
    return {
      kind: 'excel',
      label: 'Excel çalışma kitabı',
      icon: <FileSpreadsheet size={17} />,
      tileClass: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    };
  }
  if (ext === 'pptx' || mime.includes('presentation')) {
    return {
      kind: 'powerpoint',
      label: 'PowerPoint sunumu',
      icon: <Presentation size={17} />,
      tileClass: 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400',
    };
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    return {
      kind: 'pdf',
      label: 'PDF belgesi',
      icon: <FileText size={17} />,
      tileClass: 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400',
    };
  }
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
    return {
      kind: 'image',
      label: 'Görsel',
      icon: <ImageIcon size={17} />,
      tileClass: 'border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400',
    };
  }
  return {
    kind: 'file',
    label: ext ? `${ext.toLocaleUpperCase('tr-TR')} dosyası` : 'Dosya',
    icon: <FileText size={17} />,
    tileClass: 'border-theme-border bg-theme-surface text-theme-text-muted',
  };
};

const generatedFiles = (messages: Message[]): MessageAttachment[] => {
  const seen = new Set<string>();
  const files: MessageAttachment[] = [];

  messages.forEach(message => {
    (message.attachments || []).forEach(attachment => {
      if (attachment.purpose !== 'tool_output' || !Boolean(attachment.storagePath || attachment.url)) return;
      const key = attachment.attachmentId || attachment.storagePath || `${message.id}:${attachment.name || attachment.url}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      files.push(attachment);
    });
  });

  return files;
};

export function WorkspaceView(props: WorkspaceViewProps) {
  const {
    messages,
    user,
    channelRef,
    sessionId,
    onSendMessage,
    onStopGeneration,
    onToggleReaction,
    onToggleAiActive,
    onToggleZeroTouchMode,
    onAcceptAiHandRaise,
    onDismissAiHandRaise,
    onRestoreDocument,
  } = props;

  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const projects = useDataStore(state => state.projects);
  const documentContent = useDocumentStore(state => state.documentContent);
  const activeUsers = useDataStore(state => state.activeUsers);
  const typingUsers = useDataStore(state => state.typingUsers);
  const isGenerating = useDocumentStore(state => state.isGenerating);
  const isDiscussing = useDocumentStore(state => state.isDiscussing);
  const isAiActive = useDocumentStore(state => state.isAiActive);
  const isZeroTouchMode = useDocumentStore(state => state.isZeroTouchMode);
  const activeZeroTouchRoles = useDocumentStore(state => state.activeZeroTouchRoles);
  const setActiveZeroTouchRoles = useDocumentStore(state => state.setActiveZeroTouchRoles);
  const aiHandRaised = useDocumentStore(state => state.aiHandRaised);
  const selectedDocumentText = useDocumentStore(state => state.selectedDocumentText);
  const isLoadingWorkspace = useDataStore(state => state.isLoadingWorkspace);
  const messageLoadError = useMessageStore(
    state => currentWorkspaceId ? state.loadErrorsByWorkspace[currentWorkspaceId] : null,
  );
  const setShowManageParticipantsModal = useUIStore(state => state.setShowManageParticipantsModal);
  const setMobileSidebarOpen = useUIStore(state => state.setMobileSidebarOpen);

  const currentWorkspace = projects
    .flatMap(project => project.workspaces)
    .find(workspace => workspace.id === currentWorkspaceId);
  const files = useMemo(() => generatedFiles(messages), [messages]);
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<MessageAttachment | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  const openFile = useCallback((file: MessageAttachment) => {
    setFilesPanelOpen(true);
    setSelectedFile(file);
  }, []);
  const closeFile = useCallback(() => setSelectedFile(null), []);

  const fileByName = useCallback((name: string) => {
    for (let index = files.length - 1; index >= 0; index -= 1) {
      if (files[index].name === name) return files[index];
    }
    return null;
  }, [files]);

  useEffect(() => {
    setSelectedFile(null);
    setFilesPanelOpen(false);
  }, [currentWorkspaceId]);

  // ChatPanel still owns the persisted attachment card. This compatibility bridge
  // upgrades that card into a typed, visually distinct file card and routes opening
  // to the conversation file workspace instead of downloading immediately.
  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return;

    const decorateFileCards = () => {
      root.querySelectorAll<HTMLButtonElement>('button[title$="dosyasını indir"], button[title$="dosyasını sağda aç"]').forEach(button => {
        const rawTitle = button.getAttribute('title') || '';
        const name = rawTitle
          .replace(/\s+dosyasını indir$/u, '')
          .replace(/\s+dosyasını sağda aç$/u, '')
          .trim();
        if (!name) return;

        const file = fileByName(name);
        const visual = generatedFileVisual(file || { name, mimeType: '', url: '' });
        button.dataset.jetworkFileName = name;
        button.dataset.jetworkFileKind = visual.kind;
        button.classList.add('jetwork-generated-file-card');
        button.setAttribute('title', `${name} dosyasını sağda aç`);
        button.setAttribute('aria-label', `${visual.label}: ${name}. Sağ panelde aç`);

        const typeLabel = button.querySelector<HTMLDivElement>('div.min-w-0 > div:first-child');
        if (typeLabel && typeLabel.textContent !== visual.label) typeLabel.textContent = visual.label;

        const action = button.querySelector('span:last-child');
        if (action) {
          for (const node of Array.from(action.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) node.textContent = ' Aç';
          }
        }
      });
    };

    decorateFileCards();
    const observer = new MutationObserver(decorateFileCards);
    observer.observe(root, { childList: true, subtree: true });

    const interceptFileOpen = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-jetwork-file-name], button[title$="dosyasını sağda aç"]');
      if (!button || !root.contains(button)) return;
      const name = button.dataset.jetworkFileName
        || (button.getAttribute('title') || '').replace(/\s+dosyasını sağda aç$/u, '').trim();
      const file = fileByName(name);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      openFile(file);
    };

    root.addEventListener('click', interceptFileOpen, true);
    return () => {
      observer.disconnect();
      root.removeEventListener('click', interceptFileOpen, true);
    };
  }, [fileByName, openFile]);

  return (
    <div
      ref={layoutRef}
      className={`jetwork-conversation-shell relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row${selectedFile ? ' jetwork-conversation-shell--file-open' : ''}`}
    >
      {!selectedFile && (
        <div className="pointer-events-auto absolute right-3 top-2.5 z-30 hidden items-center gap-2 lg:flex">
          {files.length > 0 && (
            <button
              type="button"
              data-testid="workspace-files-toggle"
              onClick={() => setFilesPanelOpen(open => !open)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-medium shadow-sm transition-colors',
                filesPanelOpen
                  ? 'border-theme-text-muted/30 bg-theme-surface-hover text-theme-text'
                  : 'border-theme-border/70 bg-theme-bg/90 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
              )}
              aria-expanded={filesPanelOpen}
              aria-controls="workspace-files-drawer"
              title="Bu sohbette üretilen dosyalar"
            >
              <Files size={15} />
              <span>Dosyalar</span>
              <span className="rounded-full bg-theme-surface px-1.5 py-0.5 text-[10px] tabular-nums">{files.length}</span>
            </button>
          )}
          <CompactModelControl disabled={isGenerating || isDiscussing} />
        </div>
      )}

      <header
        data-testid="workspace-mobile-header"
        className="flex h-12 shrink-0 items-center gap-2 border-b border-theme-border/60 bg-theme-bg px-2.5 lg:hidden"
      >
        <button
          type="button"
          data-testid="workspace-mobile-sidebar-open"
          onClick={() => setMobileSidebarOpen(true)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text"
          aria-label="Ana menüyü aç"
          title="Ana menü"
        >
          <Menu size={19} />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-semibold text-theme-text">{currentWorkspace?.title || 'Sohbet'}</p>
        </div>
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => setFilesPanelOpen(open => !open)}
            className={cn(
              'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
              filesPanelOpen ? 'bg-theme-surface-hover text-theme-text' : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
            )}
            aria-label={`Bu sohbetteki dosyalar: ${files.length}`}
            aria-expanded={filesPanelOpen}
          >
            <Files size={18} />
            <span className="absolute right-0 top-0 min-w-4 rounded-full bg-theme-text px-1 text-center text-[9px] font-semibold leading-4 text-theme-bg">{files.length}</span>
          </button>
        )}
        <CompactModelControl mobile disabled={isGenerating || isDiscussing} />
        {currentWorkspace?.collaborators && currentWorkspace.collaborators.length > 0 && (
          <button
            type="button"
            onClick={() => setShowManageParticipantsModal(true)}
            className="inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-xs font-semibold text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text"
            aria-label="Katılımcıları yönet"
            title="Katılımcılar"
          >
            {currentWorkspace.collaborators.length}
          </button>
        )}
      </header>

      <section data-testid="workspace-chat-surface" className="relative flex min-h-0 min-w-0 flex-1">
        <ChatPanel
          messages={messages}
          onSendMessage={onSendMessage}
          onStopGeneration={onStopGeneration}
          isGenerating={isGenerating || isDiscussing}
          issueKey={currentWorkspace?.issueKey}
          status={currentWorkspace?.status}
          title={currentWorkspace?.title}
          projectName={projects.find(project => project.workspaces.some(workspace => workspace.id === currentWorkspaceId))?.name}
          hasDocument={Boolean(documentContent)}
          activeUsers={activeUsers}
          collaborators={currentWorkspace?.collaborators}
          typingUsers={typingUsers}
          onTypingStart={() => {
            if (channelRef.current && currentWorkspaceId && user) {
              channelRef.current.send({
                type: 'broadcast',
                event: 'typing_start',
                payload: {
                  itemId: currentWorkspaceId,
                  userId: sessionId.current,
                  userName: user.name,
                },
              });
            }
          }}
          onTypingEnd={() => {
            if (channelRef.current && currentWorkspaceId && user) {
              channelRef.current.send({
                type: 'broadcast',
                event: 'typing_end',
                payload: {
                  itemId: currentWorkspaceId,
                  userId: sessionId.current,
                },
              });
            }
          }}
          onToggleReaction={onToggleReaction}
          currentUser={user}
          isAiActive={isAiActive}
          onToggleAiActive={onToggleAiActive}
          isZeroTouchMode={isZeroTouchMode}
          onToggleZeroTouchMode={onToggleZeroTouchMode}
          activeZeroTouchRoles={activeZeroTouchRoles}
          setActiveZeroTouchRoles={setActiveZeroTouchRoles}
          aiHandRaised={aiHandRaised}
          onAcceptAiHandRaise={onAcceptAiHandRaise}
          onDismissAiHandRaise={onDismissAiHandRaise}
          selectedDocumentText={selectedDocumentText}
          onRestoreDocument={onRestoreDocument}
          isLoadingWorkspace={isLoadingWorkspace}
          messageLoadError={messageLoadError}
          onRetryMessageLoad={() => {
            if (currentWorkspaceId) useMessageStore.getState().retryWorkspace(currentWorkspaceId);
          }}
          onManageParticipants={() => setShowManageParticipantsModal(true)}
          fullWidth
        />
      </section>

      {filesPanelOpen && !selectedFile && (
        <>
          <button
            type="button"
            className="workspace-files-drawer-backdrop lg:hidden"
            onClick={() => setFilesPanelOpen(false)}
            aria-label="Dosyalar panelini kapat"
          />
          <aside
            id="workspace-files-drawer"
            data-testid="workspace-files-drawer"
            className="workspace-files-drawer"
            aria-label="Bu sohbetteki dosyalar"
          >
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-theme-border/60 px-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Files size={16} className="text-theme-text-muted" />
                  <h2 className="text-sm font-semibold text-theme-text">Bu sohbetteki dosyalar</h2>
                </div>
                <p className="mt-0.5 text-[10px] text-theme-text-muted">JetWork tarafından üretilen {files.length} çıktı</p>
              </div>
              <button
                type="button"
                onClick={() => setFilesPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text"
                aria-label="Dosyalar panelini kapat"
              >
                <X size={16} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {files.map((file, index) => {
                  const visual = generatedFileVisual(file);
                  return (
                    <button
                      type="button"
                      key={file.attachmentId || file.storagePath || `${file.name}-${index}`}
                      onClick={() => openFile(file)}
                      className="group flex w-full min-w-0 items-center gap-3 rounded-2xl border border-theme-border/70 bg-theme-bg p-3 text-left transition hover:border-theme-text-muted/40 hover:bg-theme-surface/60 hover:shadow-sm"
                      title={`${file.name || visual.label} dosyasını aç`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-theme-surface text-[10px] font-semibold tabular-nums text-theme-text-muted">
                        {index + 1}
                      </span>
                      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border', visual.tileClass)}>
                        {visual.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-medium text-theme-text-muted">{visual.label}</span>
                        <span className="mt-0.5 block truncate text-xs font-semibold text-theme-text">{file.name || 'JetWork çıktısı'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        </>
      )}

      {selectedFile && (
        <div data-testid="workspace-right-file-panel" className="workspace-side-file-viewer">
          <FileViewer file={selectedFile} onClose={closeFile} />
        </div>
      )}
    </div>
  );
}
