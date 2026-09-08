import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Menu } from 'lucide-react';
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

  useEffect(() => {
    setSelectedFile(null);
    setPanelOpen(false);
    setPanelTab('files');
  }, [currentWorkspaceId]);

  const openPanel = useCallback((tab: WorkspacePanelTab) => {
    setPanelTab(tab);
    setPanelOpen(true);
    setSelectedFile(null);
  }, []);

  const openFile = useCallback((file: MessageAttachment) => {
    setPanelOpen(true);
    setPanelTab('files');
    setSelectedFile(file);
  }, []);

  const closeFile = useCallback(() => setSelectedFile(null), []);

  return (
    <div className={cn('jetwork-conversation-shell relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row', selectedFile && 'jetwork-conversation-shell--file-open')}>
      {!selectedFile && (
        <div className="pointer-events-auto absolute right-3 top-2.5 z-30 hidden items-center gap-2 lg:flex">
          {currentWorkspaceId && (
            <button
              type="button"
              data-testid="workspace-panel-toggle"
              onClick={() => panelOpen ? setPanelOpen(false) : openPanel('files')}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-medium shadow-sm transition-colors',
                panelOpen ? 'border-theme-text-muted/30 bg-theme-surface-hover text-theme-text' : 'border-theme-border/70 bg-theme-bg/90 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
              )}
              aria-expanded={panelOpen}
              aria-controls="workspace-right-panel"
              title="Dosyalar, kaynaklar ve Agent Work"
            >
              <Activity size={15} />
              <span>Çalışma alanı</span>
              {files.length > 0 && <span className="rounded-full bg-theme-surface px-1.5 py-0.5 text-[10px] tabular-nums">{files.length}</span>}
            </button>
          )}
          <CompactModelControl disabled={isGenerating || isDiscussing} />
        </div>
      )}

      <header data-testid="workspace-mobile-header" className="flex h-12 shrink-0 items-center gap-2 border-b border-theme-border/60 bg-theme-bg px-2.5 lg:hidden">
        <button type="button" onClick={() => setMobileSidebarOpen(true)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" aria-label="Ana menüyü aç"><Menu size={19} /></button>
        <div className="min-w-0 flex-1 px-1"><p className="truncate text-sm font-semibold text-theme-text">{currentWorkspace?.title || 'Sohbet'}</p></div>
        {currentWorkspaceId && (
          <button type="button" onClick={() => panelOpen ? setPanelOpen(false) : openPanel('files')} className={cn('relative inline-flex h-9 w-9 items-center justify-center rounded-full', panelOpen ? 'bg-theme-surface-hover text-theme-text' : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text')} aria-label="Çalışma alanını aç" aria-expanded={panelOpen}>
            <Activity size={18} />
            {files.length > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-theme-text px-1 text-center text-[9px] font-semibold leading-4 text-theme-bg">{files.length}</span>}
          </button>
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
