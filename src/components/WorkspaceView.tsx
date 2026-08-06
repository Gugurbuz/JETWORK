import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, GripVertical, MessageSquare, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { ChatPanel } from './ChatPanel';
import { DocumentPanel } from './DocumentPanel';
import type { Message, DocumentData, MessageAttachment, MessageSendOptions } from '../types';
import type { User } from '../hooks/useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useUIStore } from '../store/useUIStore';
import { FEATURE_FLAGS } from '../lib/featureFlags';
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
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onToggleAiActive: () => void;
  onToggleZeroTouchMode: () => void;
  onAcceptAiHandRaise: () => void;
  onDismissAiHandRaise: () => void;
  onRestoreDocument: (content: DocumentData) => Promise<void>;
  onGenerateDocument: () => Promise<void>;
  onUpdateDocument: (content: DocumentData) => Promise<void>;
}

type MobileSurface = 'chat' | 'document';

const MIN_CHAT_PERCENT = 32;
const MAX_CHAT_PERCENT = 68;
const DEFAULT_CHAT_PERCENT = 44;

const canvasOpenStorageKey = (workspaceId: string) => `jetwork:document-canvas:open:${workspaceId}`;
const canvasSplitStorageKey = (workspaceId: string) => `jetwork:document-canvas:split:${workspaceId}`;

const readStoredCanvasOpen = (workspaceId: string): boolean => {
  try {
    return window.localStorage.getItem(canvasOpenStorageKey(workspaceId)) === 'true';
  } catch {
    return false;
  }
};

const readStoredSplit = (workspaceId: string): number => {
  try {
    const value = Number(window.localStorage.getItem(canvasSplitStorageKey(workspaceId)));
    if (Number.isFinite(value)) {
      return Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, value));
    }
  } catch {
    // Local storage may be unavailable in hardened browser modes.
  }
  return DEFAULT_CHAT_PERCENT;
};

export function WorkspaceView({
  messages,
  user,
  latestScore,
  latestScoreExplanation,
  channelRef,
  sessionId,
  onSendMessage,
  onToggleReaction,
  onToggleAiActive,
  onToggleZeroTouchMode,
  onAcceptAiHandRaise,
  onDismissAiHandRaise,
  onRestoreDocument,
  onGenerateDocument,
  onUpdateDocument,
}: WorkspaceViewProps) {
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

  const currentWorkspace = projects
    .flatMap(project => project.workspaces)
    .find(workspace => workspace.id === currentWorkspaceId);
  const documentCopilotEnabled = FEATURE_FLAGS.DOCUMENT_COPILOT;
  const hasDocument = documentCopilotEnabled && Boolean(documentContent);

  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>('chat');
  const [hasUnreadDocument, setHasUnreadDocument] = useState(false);
  const [chatPercent, setChatPercent] = useState(DEFAULT_CHAT_PERCENT);
  const [isDesktop, setIsDesktop] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const hydratedWorkspaceRef = useRef<string | null>(null);
  const previousDocumentRef = useRef<DocumentData | null>(null);

  const persistCanvasOpen = useCallback((open: boolean) => {
    if (!currentWorkspaceId) return;
    try {
      window.localStorage.setItem(canvasOpenStorageKey(currentWorkspaceId), String(open));
    } catch {
      // The UI remains functional even when persistence is unavailable.
    }
  }, [currentWorkspaceId]);

  const openCanvas = useCallback(() => {
    if (!hasDocument) return;
    setIsCanvasOpen(true);
    setMobileSurface('document');
    setHasUnreadDocument(false);
    persistCanvasOpen(true);
  }, [hasDocument, persistCanvasOpen]);

  const closeCanvas = useCallback(() => {
    setIsCanvasOpen(false);
    setMobileSurface('chat');
    setHasUnreadDocument(false);
    persistCanvasOpen(false);
  }, [persistCanvasOpen]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!currentWorkspaceId) {
      hydratedWorkspaceRef.current = null;
      previousDocumentRef.current = null;
      setIsCanvasOpen(false);
      setMobileSurface('chat');
      setHasUnreadDocument(false);
      return;
    }

    setChatPercent(readStoredSplit(currentWorkspaceId));
    hydratedWorkspaceRef.current = null;
    previousDocumentRef.current = null;
    setIsCanvasOpen(false);
    setMobileSurface('chat');
    setHasUnreadDocument(false);
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (!currentWorkspaceId || isLoadingWorkspace) return;

    if (hydratedWorkspaceRef.current !== currentWorkspaceId) {
      hydratedWorkspaceRef.current = currentWorkspaceId;
      previousDocumentRef.current = documentContent;
      const shouldRestoreCanvas = Boolean(documentContent) && readStoredCanvasOpen(currentWorkspaceId);
      setIsCanvasOpen(shouldRestoreCanvas);
      setMobileSurface(shouldRestoreCanvas ? 'document' : 'chat');
      return;
    }

    const previousDocument = previousDocumentRef.current;

    if (!previousDocument && documentContent) {
      setIsCanvasOpen(true);
      setMobileSurface('document');
      setHasUnreadDocument(false);
      persistCanvasOpen(true);
      toast.success('BA Analiz dokümanı hazırlandı.', {
        description: 'Doküman çalışma alanı açıldı.',
      });
    } else if (previousDocument && !documentContent) {
      closeCanvas();
    } else if (previousDocument && documentContent && previousDocument !== documentContent && !isCanvasOpen) {
      setHasUnreadDocument(true);
    }

    previousDocumentRef.current = documentContent;
  }, [
    closeCanvas,
    currentWorkspaceId,
    documentContent,
    isCanvasOpen,
    isLoadingWorkspace,
    persistCanvasOpen,
  ]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    try {
      window.localStorage.setItem(canvasSplitStorageKey(currentWorkspaceId), String(chatPercent));
    } catch {
      // Ignore storage failures.
    }
  }, [chatPercent, currentWorkspaceId]);

  const updateChatPercentFromClientX = useCallback((clientX: number) => {
    const bounds = layoutRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const next = ((clientX - bounds.left) / bounds.width) * 100;
    setChatPercent(Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, next)));
  }, []);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDesktop) return;
    event.preventDefault();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateChatPercentFromClientX(moveEvent.clientX);
    };
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

  const showChatOnMobile = !isCanvasOpen || mobileSurface === 'chat';
  const showDocumentOnMobile = isCanvasOpen && mobileSurface === 'document';

  return (
    <div ref={layoutRef} className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <section
        data-testid="workspace-chat-surface"
        className={cn(
          'relative min-h-0 min-w-0 flex-1',
          showChatOnMobile ? 'flex' : 'hidden lg:flex',
          isDesktop && isCanvasOpen && hasDocument && 'shrink-0 flex-none',
        )}
        style={isDesktop && isCanvasOpen && hasDocument ? { width: `${chatPercent}%` } : undefined}
      >
        <ChatPanel
          messages={messages}
          onSendMessage={onSendMessage}
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
            if (currentWorkspaceId) {
              useMessageStore.getState().retryWorkspace(currentWorkspaceId);
            }
          }}
          onManageParticipants={() => setShowManageParticipantsModal(true)}
          fullWidth
        />

        {hasDocument && !isCanvasOpen && (
          <button
            data-testid="document-canvas-open"
            type="button"
            onClick={openCanvas}
            className="absolute bottom-24 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-theme-primary/30 bg-theme-surface px-4 py-2.5 text-sm font-semibold text-theme-text shadow-xl transition hover:-translate-y-0.5 hover:border-theme-primary/60 hover:bg-theme-surface-hover sm:bottom-28 sm:right-6"
            title="BA Analiz çalışma alanını aç"
          >
            <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-theme-primary/10 text-theme-primary">
              <FileText size={16} />
              {hasUnreadDocument && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-theme-surface bg-emerald-500" />
              )}
            </span>
            <span className="text-left leading-tight">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-theme-text-muted">
                {hasUnreadDocument ? 'Güncellendi' : 'Doküman'}
              </span>
              <span>BA Analizi Aç</span>
            </span>
          </button>
        )}
      </section>

      {hasDocument && isCanvasOpen && isDesktop && (
        <div
          role="separator"
          aria-label="Sohbet ve doküman genişliğini ayarla"
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

      {hasDocument && isCanvasOpen && (
        <section
          data-testid="document-canvas-shell"
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-theme-bg',
            showDocumentOnMobile ? 'flex' : 'hidden lg:flex',
          )}
        >
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-theme-border bg-theme-surface px-3 shadow-sm sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                <FileText size={16} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-theme-text">BA Analiz Çalışma Alanı</p>
                <p className="hidden text-[10px] font-medium uppercase tracking-widest text-theme-text-muted sm:block">
                  Sohbetten bağımsız düzenlenebilir doküman
                </p>
              </div>
              {hasUnreadDocument && (
                <span className="hidden items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 sm:inline-flex">
                  <Sparkles size={11} /> Yeni
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileSurface('chat')}
                className="inline-flex items-center gap-2 rounded-md border border-theme-border px-3 py-1.5 text-xs font-semibold text-theme-text hover:bg-theme-surface-hover lg:hidden"
              >
                <MessageSquare size={14} /> Sohbete Dön
              </button>
              <button
                data-testid="document-canvas-close"
                type="button"
                onClick={closeCanvas}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text"
                title="Doküman çalışma alanını kapat"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <DocumentPanel
              onGenerate={onGenerateDocument}
              hasMessages={messages.length > 0}
              collaborators={currentWorkspace?.collaborators}
              onUpdateDocument={onUpdateDocument}
              onQuickAction={(prompt) => { void onSendMessage(prompt); }}
              score={latestScore}
              scoreExplanation={latestScoreExplanation}
              messages={messages}
              onRestoreDocument={onRestoreDocument}
              onManageParticipants={() => setShowManageParticipantsModal(true)}
            />
          </div>
        </section>
      )}

      {hasDocument && isCanvasOpen && (
        <nav
          data-testid="document-canvas-mobile-switch"
          aria-label="Sohbet ve doküman görünümü"
          className="absolute bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center rounded-full border border-theme-border bg-theme-surface/95 p-1 shadow-xl backdrop-blur lg:hidden"
        >
          <button
            type="button"
            onClick={() => setMobileSurface('chat')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition',
              mobileSurface === 'chat'
                ? 'bg-theme-primary text-theme-primary-fg'
                : 'text-theme-text-muted hover:text-theme-text',
            )}
          >
            <MessageSquare size={13} /> Sohbet
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileSurface('document');
              setHasUnreadDocument(false);
            }}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition',
              mobileSurface === 'document'
                ? 'bg-theme-primary text-theme-primary-fg'
                : 'text-theme-text-muted hover:text-theme-text',
            )}
          >
            <FileText size={13} /> Doküman
            {hasUnreadDocument && mobileSurface !== 'document' && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </button>
        </nav>
      )}
    </div>
  );
}
