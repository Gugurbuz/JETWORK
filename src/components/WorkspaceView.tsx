import React from 'react';
import { ChatPanel } from './ChatPanel';
import { DocumentPanel } from './DocumentPanel';
import { Message, DocumentData } from '../types';
import { User } from '../hooks/useAuth';
import { useStore } from '../store/useStore';

interface WorkspaceViewProps {
  messages: Message[];
  user: User;
  latestScore?: number;
  latestScoreExplanation?: string;
  channelRef: React.MutableRefObject<any>;
  sessionId: React.MutableRefObject<string>;
  
  onSendMessage: (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]) => Promise<void>;
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
  onUpdateDocument
}: WorkspaceViewProps) {
  const currentWorkspaceId = useStore(state => state.currentWorkspaceId);
  const projects = useStore(state => state.projects);
  const documentContent = useStore(state => state.documentContent);
  const activeUsers = useStore(state => state.activeUsers);
  const typingUsers = useStore(state => state.typingUsers);
  const isGenerating = useStore(state => state.isGenerating);
  const isDiscussing = useStore(state => state.isDiscussing);
  const isAiActive = useStore(state => state.isAiActive);
  const isZeroTouchMode = useStore(state => state.isZeroTouchMode);
  const activeZeroTouchRoles = useStore(state => state.activeZeroTouchRoles);
  const setActiveZeroTouchRoles = useStore(state => state.setActiveZeroTouchRoles);
  const aiHandRaised = useStore(state => state.aiHandRaised);
  const activeTab = useStore(state => state.activeTab);
  const setActiveTab = useStore(state => state.setActiveTab);
  const selectedDocumentText = useStore(state => state.selectedDocumentText);
  const setSelectedDocumentText = useStore(state => state.setSelectedDocumentText);
  const isLoadingWorkspace = useStore(state => state.isLoadingWorkspace);
  const setShowManageParticipantsModal = useStore(state => state.setShowManageParticipantsModal);

  const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);

  return (
    <>
      <ChatPanel 
        key={currentWorkspaceId}
        messages={messages} 
        onSendMessage={onSendMessage} 
        isGenerating={isGenerating || isDiscussing}
        issueKey={currentWorkspace?.issueKey}
        status={currentWorkspace?.status}
        title={currentWorkspace?.title}
        projectName={projects.find(p => p.workspaces.some(w => w.id === currentWorkspaceId))?.name}
        hasDocument={!!documentContent}
        activeUsers={activeUsers}
        collaborators={currentWorkspace?.collaborators}
        typingUsers={typingUsers}
        onTypingStart={() => {
          if (channelRef.current && currentWorkspaceId && user) {
            channelRef.current.send({ type: 'broadcast', event: 'typing_start', payload: { itemId: currentWorkspaceId, userId: sessionId.current, userName: user.name } });
          }
        }}
        onTypingEnd={() => {
          if (channelRef.current && currentWorkspaceId && user) {
            channelRef.current.send({ type: 'broadcast', event: 'typing_end', payload: { itemId: currentWorkspaceId, userId: sessionId.current } });
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
        onManageParticipants={() => setShowManageParticipantsModal(true)}
      />
      <DocumentPanel 
        onGenerate={onGenerateDocument}
        hasMessages={messages.length > 0}
        collaborators={currentWorkspace?.collaborators}
        onUpdateDocument={onUpdateDocument}
        score={latestScore}
        scoreExplanation={latestScoreExplanation}
        messages={messages}
        onRestoreDocument={onRestoreDocument}
        onManageParticipants={() => setShowManageParticipantsModal(true)}
      />
    </>
  );
}
