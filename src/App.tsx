import React, { useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { EditProjectModal } from './components/EditProjectModal';
import { EditWorkspaceModal } from './components/EditWorkspaceModal';
import { ConfirmModal } from './components/ConfirmModal';
import { ChatPanel } from './components/ChatPanel';
import { DocumentPanel } from './components/DocumentPanel';
import { LandingPage } from './components/LandingPage';
import { NewItemModal } from './components/NewItemModal';
import { NewProjectModal } from './components/NewProjectModal';
import { OnboardingPage } from './components/OnboardingPage';
import { ProjectDashboard } from './components/ProjectDashboard';
import { SettingsModal } from './components/SettingsModal';
import { ManageParticipantsModal } from './components/ManageParticipantsModal';
import { LayoutDashboard } from 'lucide-react';

import { useStore } from './store/useStore';
import { useAuth } from './hooks/useAuth';
import { useWorkspaces } from './hooks/useWorkspaces';
import { useWorkspaceChannel } from './hooks/useWorkspaceChannel';
import { useMessages } from './hooks/useMessages';
import { useDocument } from './hooks/useDocument';
import { useProjectActions } from './hooks/useProjectActions';

export default function App() {
  const {
    user,
    projects,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    currentProjectId,
    setCurrentProjectId,
    theme,
    setTheme,
    showSettingsModal,
    setShowSettingsModal,
    showNewItemModal,
    setShowNewItemModal,
    showNewProjectModal,
    setShowNewProjectModal,
    showManageParticipantsModal,
    setShowManageParticipantsModal,
    editingProject,
    setEditingProject,
    editingWorkspace,
    setEditingWorkspace,
    deletingProject,
    setDeletingProject,
    deletingWorkspace,
    setDeletingWorkspace,
    messages,
    setMessages,
    isGenerating,
    isDiscussing,
    documentContent,
    activeTab,
    setActiveTab,
    latestScore,
    latestScoreExplanation,
    selectedDocumentText,
    setSelectedDocumentText,
    isAiActive,
    setIsAiActive,
    isZeroTouchMode,
    setIsZeroTouchMode,
    activeZeroTouchRoles,
    setActiveZeroTouchRoles,
    aiHandRaised,
    setAiHandRaised,
    projectMemory,
    selectedModel,
    setSelectedModel,
    activeUsers,
    typingUsers,
    isLoadingWorkspace
  } = useStore();

  const { isAuthReady, handleUpdateUser, handleLogout } = useAuth();
  useWorkspaces();
  
  const { channelRef, sessionId } = useWorkspaceChannel();
  const { handleSendMessage, handleToggleReaction, handleAcceptAiHandRaise } = useMessages(channelRef);
  const { handleGenerateDocument, handleUpdateDocument } = useDocument();
  const {
    handleNewProject,
    handleNewWorkspace,
    handleEditProject,
    handleEditWorkspace,
    handleDeleteProject,
    handleDeleteWorkspace,
    handleAddParticipant,
    handleRemoveParticipant,
    handleLeaveWorkspace,
    handleSelectWorkspace,
    handleSelectProject
  } = useProjectActions();

  useEffect(() => {
    document.documentElement.className = `theme-${theme}`;
  }, [theme]);

  if (!isAuthReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-theme-bg">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  if (!user.name || !user.role) {
    return <OnboardingPage user={user} onComplete={handleUpdateUser} />;
  }

  const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);

  return (
    <div className="flex h-screen bg-theme-bg text-theme-text font-sans overflow-hidden selection:bg-theme-primary selection:text-theme-primary-fg transition-colors duration-300 relative">
      {/* Background Gradient for Glass Effect */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-theme-primary/20 blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-theme-primary/10 blur-[100px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-theme-primary/20 blur-[150px]" />
      </div>
      
      {showSettingsModal && (
        <SettingsModal 
          user={user}
          onClose={() => setShowSettingsModal(false)}
          onUpdateUser={handleUpdateUser}
          selectedModel={selectedModel}
          onUpdateModel={(model) => {
            setSelectedModel(model);
            localStorage.setItem('jetwork-model', model);
          }}
        />
      )}
      {showNewItemModal && (
        <NewItemModal 
          projects={projects}
          currentProjectId={currentProjectId}
          onClose={() => setShowNewItemModal(false)} 
          onSubmit={handleNewWorkspace} 
        />
      )}
      {showNewProjectModal && (
        <NewProjectModal 
          onClose={() => setShowNewProjectModal(false)} 
          onSubmit={handleNewProject} 
        />
      )}
      {showManageParticipantsModal && currentWorkspace && user && (
        <ManageParticipantsModal
          collaborators={currentWorkspace.collaborators}
          currentUserId={user.uid}
          ownerId={currentWorkspace.ownerId}
          onClose={() => setShowManageParticipantsModal(false)}
          onAddParticipant={handleAddParticipant}
          onRemoveParticipant={handleRemoveParticipant}
          onLeaveWorkspace={handleLeaveWorkspace}
        />
      )}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSubmit={handleEditProject}
        />
      )}
      {editingWorkspace && (
        <EditWorkspaceModal
          workspace={editingWorkspace}
          onClose={() => setEditingWorkspace(null)}
          onSubmit={handleEditWorkspace}
        />
      )}
      {deletingProject && (
        <ConfirmModal
          title="Projeyi Sil"
          message="Bu projeyi ve içindeki tüm çalışma alanlarını silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          confirmText="Sil"
          onConfirm={handleDeleteProject}
          onCancel={() => setDeletingProject(null)}
          expectedConfirmationText={projects.find(p => p.id === deletingProject)?.name}
        />
      )}
      {deletingWorkspace && (
        <ConfirmModal
          title="Çalışma Alanını Sil"
          message="Bu çalışma alanını silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          confirmText="Sil"
          onConfirm={handleDeleteWorkspace}
          onCancel={() => setDeletingWorkspace(null)}
          expectedConfirmationText={projects.flatMap(p => p.workspaces).find(w => w.id === deletingWorkspace)?.title}
        />
      )}
      {!currentWorkspaceId && (
        <Sidebar 
          user={user}
          projects={projects} 
          currentWorkspaceId={currentWorkspaceId}
          currentProjectId={currentProjectId}
          projectMemory={projectMemory}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectProject={handleSelectProject}
          onNewWorkspace={() => setShowNewItemModal(true)}
          onNewProject={() => setShowNewProjectModal(true)}
          onEditProject={setEditingProject}
          onDeleteProject={setDeletingProject}
          theme={theme}
          onThemeChange={setTheme}
          onLogout={handleLogout}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
      )}
      <main className="flex-1 flex relative z-10">
        {!currentWorkspaceId ? (
          currentProjectId && projects.find(p => p.id === currentProjectId) ? (
            <ProjectDashboard 
              project={projects.find(p => p.id === currentProjectId)!}
              onSelectWorkspace={handleSelectWorkspace}
              onNewWorkspace={() => setShowNewItemModal(true)}
              onEditWorkspace={setEditingWorkspace}
              onDeleteWorkspace={setDeletingWorkspace}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-theme-bg">
              <div className="text-center">
                <div className="w-16 h-16 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-center mx-auto mb-4 text-theme-text-muted">
                  <LayoutDashboard size={32} />
                </div>
                <h2 className="text-xl font-bold text-theme-text mb-2">JetWork'e Hoş Geldiniz</h2>
                <p className="text-theme-text-muted mb-6">Başlamak için sol menüden bir proje seçin.</p>
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => setShowNewProjectModal(true)}
                    className="px-4 py-2 bg-theme-surface border border-theme-border hover:bg-theme-surface-hover text-theme-text rounded-md text-sm font-semibold transition-colors"
                  >
                    Yeni Proje
                  </button>
                </div>
              </div>
            </div>
          )
        ) : (
          <>
            <ChatPanel 
              key={currentWorkspaceId}
              messages={messages} 
              onSendMessage={handleSendMessage} 
              onRemoveMessage={(id) => setMessages(prev => prev.filter(m => m.id !== id))}
              isGenerating={isGenerating || isDiscussing}
              issueKey={currentWorkspace?.issueKey}
              status={currentWorkspace?.status}
              title={currentWorkspace?.title}
              projectName={projects.find(p => p.workspaces.some(w => w.id === currentWorkspaceId))?.name}
              hasDocument={!!documentContent}
              onBack={() => setCurrentWorkspaceId(null)}
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
              onToggleReaction={handleToggleReaction}
              currentUser={user}
              isAiActive={isAiActive}
              onToggleAiActive={() => {
                const newValue = !isAiActive;
                setIsAiActive(newValue);
                if (newValue && isZeroTouchMode) {
                  setIsZeroTouchMode(false);
                }
              }}
              isZeroTouchMode={isZeroTouchMode}
              onToggleZeroTouchMode={() => {
                const newValue = !isZeroTouchMode;
                setIsZeroTouchMode(newValue);
                if (newValue && isAiActive) {
                  setIsAiActive(false);
                }
              }}
              activeZeroTouchRoles={activeZeroTouchRoles}
              setActiveZeroTouchRoles={setActiveZeroTouchRoles}
              aiHandRaised={aiHandRaised}
              onAcceptAiHandRaise={handleAcceptAiHandRaise}
              onDismissAiHandRaise={() => setAiHandRaised(null)}
              selectedDocumentText={selectedDocumentText}
              onRestoreDocument={handleUpdateDocument}
              isLoadingWorkspace={isLoadingWorkspace}
              onManageParticipants={() => setShowManageParticipantsModal(true)}
            />
            <DocumentPanel 
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              documentContent={documentContent}
              onGenerate={handleGenerateDocument}
              isGenerating={isGenerating}
              isDiscussing={isDiscussing}
              hasMessages={messages.length > 0}
              collaborators={currentWorkspace?.collaborators}
              onUpdateDocument={handleUpdateDocument}
              onSelectionChange={setSelectedDocumentText}
              score={latestScore}
              scoreExplanation={latestScoreExplanation}
              messages={messages}
              onRestoreDocument={handleUpdateDocument}
              isLoadingWorkspace={isLoadingWorkspace}
              onManageParticipants={() => setShowManageParticipantsModal(true)}
            />
          </>
        )}
      </main>
    </div>
  );
}
