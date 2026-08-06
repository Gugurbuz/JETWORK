import React from 'react';
import { ChatPanel } from './ChatPanel';
import { DocumentPanel } from './DocumentPanel';
import type { Message, DocumentData, MessageAttachment, MessageSendOptions } from '../types';
import type { User } from '../hooks/useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useUIStore } from '../store/useUIStore';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { useMessageStore } from '../store/useMessageStore';

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
  const showDocumentPanel = FEATURE_FLAGS.DOCUMENT_COPILOT;

  return (
    <>
      <ChatPanel
        messages={messages}
        onSendMessage={onSendMessage}
        isGenerating={isGenerating || isDiscussing}
        issueKey={currentWorkspace?.issueKey}
        status={currentWorkspace?.status}
        title={currentWorkspace?.title}
        projectName={projects.find(project => project.workspaces.some(workspace => workspace.id === currentWorkspaceId))?.name}
        hasDocument={!!documentContent}
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
        fullWidth={!showDocumentPanel}
      />

      {showDocumentPanel && (
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
      )}
    </>
  );
}
