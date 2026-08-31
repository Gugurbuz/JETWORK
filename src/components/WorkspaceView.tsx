import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import { FileViewer } from './FileViewer';
import { CompactModelControl } from './CompactModelControl';
import type { Message, DocumentData, MessageAttachment, MessageSendOptions } from '../types';
import type { User } from '../hooks/useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useUIStore } from '../store/useUIStore';
import { useMessageStore } from '../store/useMessageStore';
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

const generatedFiles = (messages: Message[]): MessageAttachment[] => messages.flatMap(message => (
  (message.attachments || []).filter(attachment => (
    attachment.purpose === 'tool_output'
    && Boolean(attachment.storagePath || attachment.url)
  ))
));

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
  const [selectedFile, setSelectedFile] = useState<MessageAttachment | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  const openFile = useCallback((file: MessageAttachment) => setSelectedFile(file), []);
  const closeFile = useCallback(() => setSelectedFile(null), []);

  const fileByName = useCallback((name: string) => {
    for (let index = files.length - 1; index >= 0; index -= 1) {
      if (files[index].name === name) return files[index];
    }
    return null;
  }, [files]);

  useEffect(() => {
    setSelectedFile(null);
  }, [currentWorkspaceId]);

  // Compatibility bridge for the current ChatPanel output card. The generated file
  // stays inline under the assistant response; clicking that card opens this workspace panel.
  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return;

    const decorateFileCards = () => {
      root.querySelectorAll<HTMLButtonElement>('button[title$="dosyasını indir"]').forEach(button => {
        const rawTitle = button.getAttribute('title') || '';
        const name = rawTitle.replace(/\s+dosyasını indir$/u, '').trim();
        if (!name) return;
        button.dataset.jetworkFileName = name;
        button.setAttribute('title', `${name} dosyasını sağda aç`);
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
        <div className="pointer-events-auto absolute right-14 top-2.5 z-30 hidden lg:block">
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

      {selectedFile && (
        <div data-testid="workspace-right-file-panel" className="workspace-side-file-viewer">
          <FileViewer file={selectedFile} onClose={closeFile} />
        </div>
      )}
    </div>
  );
}
