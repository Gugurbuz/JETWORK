import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, FileText, GripVertical, Menu, MessageSquare } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import { ArtifactWorkspace } from './ArtifactWorkspace';
import type { Message, DocumentData, MessageAttachment, MessageSendOptions } from '../types';
import type { User } from '../hooks/useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useUIStore } from '../store/useUIStore';
import { useMessageStore } from '../store/useMessageStore';
import { cn } from '../lib/utils';

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

type MobileSurface = 'chat' | 'artifact';

const MIN_CHAT_PERCENT = 32;
const MAX_CHAT_PERCENT = 68;
const DEFAULT_CHAT_PERCENT = 48;
const UNINITIALIZED_ARTIFACT_KEY = '__workspace_uninitialized__';

const artifactSplitStorageKey = (workspaceId: string) => `jetwork:artifact-workspace:split:${workspaceId}`;

const readStoredSplit = (workspaceId: string): number => {
  try {
    const value = Number(window.localStorage.getItem(artifactSplitStorageKey(workspaceId)));
    if (Number.isFinite(value)) return Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, value));
  } catch {
    // Browser storage may be unavailable in hardened modes.
  }
  return DEFAULT_CHAT_PERCENT;
};

const artifactKey = (attachment?: MessageAttachment | null) => {
  if (!attachment) return '';
  return attachment.attachmentId
    || [attachment.storageBucket, attachment.storagePath].filter(Boolean).join('/')
    || `${attachment.name || 'artifact'}:${attachment.url || ''}`;
};

const generatedArtifacts = (messages: Message[]): MessageAttachment[] => messages.flatMap(message => (
  (message.attachments || []).filter(attachment => (
    attachment.purpose === 'tool_output'
    && Boolean(attachment.storagePath || attachment.url)
  ))
));

const extensionLabel = (artifact?: MessageAttachment | null) => (
  String(artifact?.name || '').split('.').pop()?.toLocaleUpperCase('en-US') || 'FILE'
);

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
  const artifacts = useMemo(() => generatedArtifacts(messages), [messages]);
  const latestArtifact = artifacts.length ? artifacts[artifacts.length - 1] : null;

  const [selectedArtifact, setSelectedArtifact] = useState<MessageAttachment | null>(null);
  const [isArtifactOpen, setIsArtifactOpen] = useState(false);
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>('chat');
  const [chatPercent, setChatPercent] = useState(DEFAULT_CHAT_PERCENT);
  const [isDesktop, setIsDesktop] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const lastArtifactKeyRef = useRef(UNINITIALIZED_ARTIFACT_KEY);

  const openArtifact = useCallback((artifact: MessageAttachment) => {
    setSelectedArtifact(artifact);
    setIsArtifactOpen(true);
    setMobileSurface('artifact');
  }, []);

  const closeArtifact = useCallback(() => {
    setIsArtifactOpen(false);
    setMobileSurface('chat');
  }, []);

  const artifactByName = useCallback((name: string) => {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const attachments = messages[messageIndex].attachments || [];
      for (let attachmentIndex = attachments.length - 1; attachmentIndex >= 0; attachmentIndex -= 1) {
        const attachment = attachments[attachmentIndex];
        if (
          attachment.purpose === 'tool_output'
          && Boolean(attachment.storagePath || attachment.url)
          && attachment.name === name
        ) return attachment;
      }
    }
    return null;
  }, [messages]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setSelectedArtifact(null);
      setIsArtifactOpen(false);
      setMobileSurface('chat');
      lastArtifactKeyRef.current = UNINITIALIZED_ARTIFACT_KEY;
      return;
    }
    setChatPercent(readStoredSplit(currentWorkspaceId));
    setSelectedArtifact(null);
    setIsArtifactOpen(false);
    setMobileSurface('chat');
    lastArtifactKeyRef.current = UNINITIALIZED_ARTIFACT_KEY;
  }, [currentWorkspaceId]);

  useEffect(() => {
    const nextKey = artifactKey(latestArtifact);
    if (lastArtifactKeyRef.current === UNINITIALIZED_ARTIFACT_KEY) {
      lastArtifactKeyRef.current = nextKey;
      return;
    }
    if (nextKey && nextKey !== lastArtifactKeyRef.current && latestArtifact) {
      lastArtifactKeyRef.current = nextKey;
      openArtifact(latestArtifact);
      return;
    }
    lastArtifactKeyRef.current = nextKey;
  }, [latestArtifact, openArtifact]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    try {
      window.localStorage.setItem(artifactSplitStorageKey(currentWorkspaceId), String(chatPercent));
    } catch {
      // Ignore persistence failures.
    }
  }, [chatPercent, currentWorkspaceId]);

  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return;

    const decorateArtifactCards = () => {
      root.querySelectorAll<HTMLButtonElement>('button[title$="dosyasını indir"]').forEach(button => {
        const rawTitle = button.getAttribute('title') || '';
        const name = rawTitle.replace(/\s+dosyasını indir$/u, '').trim();
        if (!name) return;
        button.dataset.jetworkArtifactName = name;
        button.setAttribute('title', `${name} önizlemesini sağda aç`);
        const label = button.querySelector('span:last-child');
        if (label) {
          for (const node of Array.from(label.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) node.textContent = ' Aç';
          }
        }
      });
    };

    decorateArtifactCards();
    const observer = new MutationObserver(decorateArtifactCards);
    observer.observe(root, { childList: true, subtree: true });

    const interceptArtifactClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-jetwork-artifact-name], button[title$="dosyasını indir"]');
      if (!button || !root.contains(button)) return;
      const title = button.getAttribute('title') || '';
      const fallbackName = title.replace(/\s+(?:dosyasını indir|önizlemesini sağda aç)$/u, '').trim();
      const name = button.dataset.jetworkArtifactName || fallbackName;
      const artifact = artifactByName(name);
      if (!artifact) return;
      event.preventDefault();
      event.stopPropagation();
      openArtifact(artifact);
    };

    root.addEventListener('click', interceptArtifactClick, true);
    return () => {
      observer.disconnect();
      root.removeEventListener('click', interceptArtifactClick, true);
    };
  }, [artifactByName, openArtifact]);

  const updateChatPercentFromClientX = useCallback((clientX: number) => {
    const bounds = layoutRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const next = ((clientX - bounds.left) / bounds.width) * 100;
    setChatPercent(Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, next)));
  }, []);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDesktop) return;
    event.preventDefault();
    const handlePointerMove = (moveEvent: PointerEvent) => updateChatPercentFromClientX(moveEvent.clientX);
    const stop = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stop);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -2 : 2;
    setChatPercent(value => Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, value + delta)));
  };

  const showChatOnMobile = mobileSurface === 'chat';
  const showArtifactOnMobile = mobileSurface === 'artifact';
  const hasArtifact = Boolean(selectedArtifact);

  return (
    <div ref={layoutRef} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
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

      {hasArtifact && (
        <nav
          data-testid="artifact-workspace-mobile-switch"
          aria-label="Sohbet ve artifact görünümü"
          className="flex h-11 shrink-0 items-center border-b border-theme-border bg-theme-bg px-3 lg:hidden"
        >
          <div className="grid w-full grid-cols-2 rounded-lg bg-theme-surface p-1">
            <button
              type="button"
              onClick={() => setMobileSurface('chat')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                mobileSurface === 'chat' ? 'bg-theme-bg text-theme-text shadow-sm' : 'text-theme-text-muted',
              )}
            >
              <MessageSquare size={13} /> Sohbet
            </button>
            <button
              type="button"
              onClick={() => {
                setIsArtifactOpen(true);
                setMobileSurface('artifact');
              }}
              className={cn(
                'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                mobileSurface === 'artifact' ? 'bg-theme-bg text-theme-text shadow-sm' : 'text-theme-text-muted',
              )}
            >
              <FileText size={13} /> <span className="truncate">{selectedArtifact?.name || 'Artifact'}</span>
            </button>
          </div>
        </nav>
      )}

      <section
        data-testid="workspace-chat-surface"
        className={cn(
          'relative min-h-0 min-w-0 flex-1',
          showChatOnMobile ? 'flex' : 'hidden lg:flex',
          isDesktop && isArtifactOpen && hasArtifact && 'shrink-0 flex-none',
        )}
        style={isDesktop && isArtifactOpen && hasArtifact ? { width: `${chatPercent}%` } : undefined}
      >
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

      {hasArtifact && !isArtifactOpen && (
        <button
          data-testid="artifact-workspace-open"
          type="button"
          onClick={() => {
            setIsArtifactOpen(true);
            setMobileSurface('artifact');
          }}
          className="group relative hidden w-14 shrink-0 flex-col items-center justify-center gap-2 border-l border-theme-border bg-theme-surface text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text lg:flex"
          title={`${selectedArtifact?.name || 'Artifact'} önizlemesini aç`}
          aria-label="Artifact çalışma alanını aç"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
            <FileText size={17} />
          </span>
          <span className="max-w-11 truncate text-[9px] font-bold uppercase tracking-wider text-theme-text">{extensionLabel(selectedArtifact)}</span>
          <ChevronLeft size={14} className="mt-1 transition-transform group-hover:-translate-x-0.5" />
        </button>
      )}

      {hasArtifact && isArtifactOpen && isDesktop && (
        <div
          role="separator"
          aria-label="Sohbet ve artifact genişliğini ayarla"
          aria-orientation="vertical"
          aria-valuemin={MIN_CHAT_PERCENT}
          aria-valuemax={MAX_CHAT_PERCENT}
          aria-valuenow={Math.round(chatPercent)}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
          className="group relative z-40 hidden w-2 shrink-0 cursor-col-resize items-center justify-center border-x border-theme-border/50 bg-theme-bg outline-none hover:bg-theme-surface-hover focus-visible:ring-2 focus-visible:ring-theme-primary lg:flex"
        >
          <span className="flex h-12 w-5 items-center justify-center rounded-full border border-theme-border bg-theme-surface text-theme-text-muted shadow-sm transition group-hover:text-theme-primary">
            <GripVertical size={13} />
          </span>
        </div>
      )}

      {hasArtifact && isArtifactOpen && selectedArtifact && (
        <section
          data-testid="artifact-workspace-shell"
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-theme-bg',
            showArtifactOnMobile ? 'flex' : 'hidden lg:flex',
          )}
        >
          <ArtifactWorkspace artifact={selectedArtifact} onClose={closeArtifact} />
        </section>
      )}
    </div>
  );
}
