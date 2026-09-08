import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookOpenText, Files, Menu, MoreHorizontal } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import { FileViewer } from './FileViewer';
import { CompactModelControl } from './CompactModelControl';
import { WorkspaceRightPanel } from './workspace/WorkspaceRightPanel';
import type { Message, DocumentData, MessageAttachment, MessageSendOptions } from '../types';
import type { User } from '../hooks/useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useUIStore } from '../store/useUIStore';
import { useMessageStore } from '../store/useMessageStore';
import { cn } from '../lib/utils';
import { fileVisualMeta } from '../lib/files/fileMeta';
import '../jetwork-conversation-shell.css';
import '../workspace-file-panel.css';
import '../workspace-right-panel.css';

type WorkspacePanelTab = 'files' | 'sources' | 'work';

interface WorkspaceViewProps {
  messages: Message[];
  user: User;
  latestScore?: number;
  latestScoreExplanation?: string;
  channelRef: React.MutableRefObject<any>;
  sessionId: React.MutableRefObject<string>;
  onSendMessage: (text: string, attachments?: MessageAttachment[], options?: MessageSendOptions) => Promise<void>;
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
    messages, user, channelRef, sessionId, onSendMessage, onStopGeneration, onToggleReaction,
    onToggleAiActive, onToggleZeroTouchMode, onAcceptAiHandRaise, onDismissAiHandRaise, onRestoreDocument,
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
  const messageLoadError = useMessageStore(state => currentWorkspaceId ? state.loadErrorsByWorkspace[currentWorkspaceId] : null);
  const setShowManageParticipantsModal = useUIStore(state => state.setShowManageParticipantsModal);
  const setMobileSidebarOpen = useUIStore(state => state.setMobileSidebarOpen);

  const currentWorkspace = projects.flatMap(project => project.workspaces).find(workspace => workspace.id === currentWorkspaceId);
  const projectName = projects.find(project => project.workspaces.some(workspace => workspace.id === currentWorkspaceId))?.name;
  const files = useMemo(() => generatedFiles(messages), [messages]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<WorkspacePanelTab>('files');
  const [selectedFile, setSelectedFile] = useState<MessageAttachment | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedFile(null);
    setPanelOpen(false);
    setPanelTab('files');
    setActionsMenuOpen(false);
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (!actionsMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-workspace-actions-root="true"]')) return;
      setActionsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionsMenuOpen]);

  const openPanel = useCallback((tab: WorkspacePanelTab) => {
    setPanelTab(tab);
    setPanelOpen(true);
    setSelectedFile(null);
    setActionsMenuOpen(false);
  }, []);

  const openFile = useCallback((file: MessageAttachment) => {
    setPanelOpen(true);
    setPanelTab('files');
    setSelectedFile(file);
    setActionsMenuOpen(false);
  }, []);

  const closeFile = useCallback(() => setSelectedFile(null), []);

  const fileByName = useCallback((name: string) => files.find(file => file.name === name), [files]);

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
        const visual = fileVisualMeta(file || { name, mimeType: '' });
        button.dataset.jetworkFileName = name;
        button.dataset.jetworkFileKind = visual.kind;
        button.classList.add('jetwork-generated-file-card');
        button.setAttribute('title', `${name} dosyasını sağda aç`);
        button.setAttribute('aria-label', `${visual.label}: ${name}. Sağ panelde aç`);

        const typeLabel = button.querySelector<HTMLDivElement>('div.min-w-0 > div:first-child');
        if (typeLabel && typeLabel.textContent !== visual.label) typeLabel.textContent = visual.label;

        const action = button.querySelector<HTMLSpanElement>('span:last-child');
        if (action) {
          Array.from(action.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes('İndir')) node.textContent = ' Aç';
          });
        }
      });
    };

    const handleGeneratedFileOpen = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('button[data-jetwork-file-name]');
      if (!button || !root.contains(button)) return;
      const file = fileByName(button.dataset.jetworkFileName || '');
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      openFile(file);
    };

    decorateFileCards();
    const observer = new MutationObserver(decorateFileCards);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('click', handleGeneratedFileOpen, true);

    return () => {
      observer.disconnect();
      root.removeEventListener('click', handleGeneratedFileOpen, true);
    };
  }, [fileByName, openFile, messages.length]);

  const actionsMenu = (mobile: boolean) => (
    <div
      data-testid={mobile ? 'workspace-actions-menu-mobile' : 'workspace-actions-menu'}
      className={cn(
        'absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-2xl border border-theme-border/80 bg-theme-bg/98 shadow-2xl backdrop-blur-xl',
        mobile && 'w-[min(18rem,calc(100vw-1rem))]',
      )}
      role="menu"
      aria-label="Sohbet araçları"
    >
      <div className="border-b border-theme-border/60 px-4 py-3">
        <p className="text-sm font-semibold text-theme-text">Sohbet araçları</p>
        <p className="mt-0.5 text-[11px] leading-4 text-theme-text-muted">Bu konuşmaya ait içerik ve çalışma izleri</p>
      </div>
      <div className="p-1.5">
        <button
          type="button"
          role="menuitem"
          onClick={() => openPanel('files')}
          className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-theme-surface-hover', panelOpen && panelTab === 'files' && 'bg-theme-surface-hover')}
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-theme-surface text-theme-text"><Files size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-theme-text">Dosyalar</span>
            <span className="block truncate text-[11px] text-theme-text-muted">Bu sohbette oluşturulan çıktılar</span>
          </span>
          {files.length > 0 && <span className="min-w-5 rounded-full bg-theme-surface px-1.5 text-center text-[10px] font-semibold leading-5 text-theme-text-muted">{files.length}</span>}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => openPanel('sources')}
          className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-theme-surface-hover', panelOpen && panelTab === 'sources' && 'bg-theme-surface-hover')}
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-theme-surface text-theme-text"><BookOpenText size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-theme-text">Kaynaklar</span>
            <span className="block truncate text-[11px] text-theme-text-muted">Yanıtlarda kullanılan referanslar</span>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => openPanel('work')}
          className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-theme-surface-hover', panelOpen && panelTab === 'work' && 'bg-theme-surface-hover')}
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-theme-surface text-theme-text"><Activity size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-theme-text">Agent Work</span>
            <span className="block truncate text-[11px] text-theme-text-muted">Ajanın adımları, araçları ve çalışma akışı</span>
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <div ref={layoutRef} className={cn('jetwork-conversation-shell relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row', selectedFile && 'jetwork-conversation-shell--file-open')}>
      {!selectedFile && (
        <div className="pointer-events-auto absolute right-3 top-2.5 z-30 hidden items-center gap-2 lg:flex">
          {currentWorkspaceId && (
            <div className="relative" data-workspace-actions-root="true">
              <button
                type="button"
                data-testid="workspace-actions-menu-toggle"
                onClick={() => setActionsMenuOpen(open => !open)}
                className={cn(
                  'relative inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition-colors',
                  actionsMenuOpen ? 'border-theme-text-muted/30 bg-theme-surface-hover text-theme-text' : 'border-theme-border/70 bg-theme-bg/90 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
                )}
                aria-expanded={actionsMenuOpen}
                aria-haspopup="menu"
                title="Sohbet araçları"
                aria-label="Sohbet araçlarını aç"
              >
                <MoreHorizontal size={18} />
                {files.length > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-theme-text px-1 text-center text-[9px] font-semibold leading-4 text-theme-bg">{files.length}</span>}
              </button>
              {actionsMenuOpen && actionsMenu(false)}
            </div>
          )}
          <CompactModelControl disabled={isGenerating || isDiscussing} />
        </div>
      )}

      <header data-testid="workspace-mobile-header" className="flex h-12 shrink-0 items-center gap-2 border-b border-theme-border/60 bg-theme-bg px-2.5 lg:hidden">
        <button type="button" onClick={() => setMobileSidebarOpen(true)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" aria-label="Ana menüyü aç"><Menu size={19} /></button>
        <div className="min-w-0 flex-1 px-1"><p className="truncate text-sm font-semibold text-theme-text">{currentWorkspace?.title || 'Sohbet'}</p></div>
        {currentWorkspaceId && (
          <div className="relative" data-workspace-actions-root="true">
            <button
              type="button"
              data-testid="workspace-actions-menu-toggle-mobile"
              onClick={() => setActionsMenuOpen(open => !open)}
              className={cn('relative inline-flex h-9 w-9 items-center justify-center rounded-full', actionsMenuOpen ? 'bg-theme-surface-hover text-theme-text' : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text')}
              aria-label="Sohbet araçlarını aç"
              aria-expanded={actionsMenuOpen}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={19} />
              {files.length > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-theme-text px-1 text-center text-[9px] font-semibold leading-4 text-theme-bg">{files.length}</span>}
            </button>
            {actionsMenuOpen && actionsMenu(true)}
          </div>
        )}
        <CompactModelControl mobile disabled={isGenerating || isDiscussing} />
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
          projectName={projectName}
          hasDocument={Boolean(documentContent)}
          activeUsers={activeUsers}
          collaborators={currentWorkspace?.collaborators}
          typingUsers={typingUsers}
          onTypingStart={() => {
            if (channelRef.current && currentWorkspaceId && user) channelRef.current.send({ type: 'broadcast', event: 'typing_start', payload: { itemId: currentWorkspaceId, userId: sessionId.current, userName: user.name } });
          }}
          onTypingEnd={() => {
            if (channelRef.current && currentWorkspaceId && user) channelRef.current.send({ type: 'broadcast', event: 'typing_end', payload: { itemId: currentWorkspaceId, userId: sessionId.current } });
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
          onRetryMessageLoad={() => { if (currentWorkspaceId) useMessageStore.getState().retryWorkspace(currentWorkspaceId); }}
          onManageParticipants={() => setShowManageParticipantsModal(true)}
          fullWidth
        />
      </section>

      {panelOpen && currentWorkspaceId && !selectedFile && (
        <WorkspaceRightPanel
          workspaceId={currentWorkspaceId}
          messages={messages}
          legacyFiles={files}
          refreshKey={messages.length + files.length}
          initialTab={panelTab}
          onOpenFile={openFile}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {selectedFile && <div data-testid="workspace-right-file-panel" className="workspace-side-file-viewer"><FileViewer file={selectedFile} onClose={closeFile} /></div>}
    </div>
  );
}
