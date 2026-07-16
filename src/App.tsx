import React, { useState, useRef, useEffect } from 'react';
import { Sidebar, ThemeType } from './components/Sidebar';
import { ModalsContainer } from './components/ModalsContainer';
import { AISettingsModal } from './components/AISettingsModal';
import { WorkspaceView } from './components/WorkspaceView';
import { MainContent } from './components/MainContent';
import { LandingPage } from './components/LandingPage';
import { OnboardingPage } from './components/OnboardingPage';
import { ProjectDashboard } from './components/ProjectDashboard';
import { DocumentData } from './types';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { nowIso } from './lib/mapping';
import { useMessageStore } from './store/useMessageStore';
import { useDataStore } from './store/useDataStore';
import { useDocumentStore } from './store/useDocumentStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useUIStore } from './store/useUIStore';
import { supabase, logOut } from './supabase';
import { saveDocumentAndVersion } from './utils/documentUtils';
import { useMessages } from './hooks/useMessages';
import { useAuth } from './hooks/useAuth';
import { useProjects } from './hooks/useProjects';
import { useWorkspaceSync } from './hooks/useWorkspaceSync';
import { useWorkspaceHandlers } from './hooks/useWorkspaceHandlers';

function AuthLoadingState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-theme-bg text-theme-text p-6">
      <div className="w-full max-w-md rounded-2xl border border-theme-border bg-theme-surface p-8 text-center shadow-lg">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-theme-border bg-theme-bg text-theme-primary">
          {error ? <AlertTriangle size={22} /> : <Loader2 size={22} className="animate-spin" />}
        </div>
        <h1 className="mb-2 text-lg font-semibold tracking-tight">
          {error ? 'Oturum başlatılamadı' : 'JetWork hazırlanıyor'}
        </h1>
        <p className="text-sm leading-relaxed text-theme-text-muted">
          {error || 'Çalışma alanınız ve oturum bilgileriniz yükleniyor.'}
        </p>
        {error && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-theme-primary px-4 py-2 text-sm font-semibold text-theme-primary-fg transition-colors hover:bg-theme-primary-hover"
          >
            <RefreshCw size={16} />
            Tekrar dene
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  // Supabase owns authentication, persistence, realtime collaboration, and AI gateway access.
  const { user, setUser, isAuthReady, authError, retryAuth } = useAuth();

  const showNewItemModal = useUIStore(state => state.showNewItemModal);
  const setShowNewItemModal = useUIStore(state => state.setShowNewItemModal);
  const showNewProjectModal = useUIStore(state => state.showNewProjectModal);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const showSettingsModal = useUIStore(state => state.showSettingsModal);
  const setShowSettingsModal = useUIStore(state => state.setShowSettingsModal);
  const showManageParticipantsModal = useUIStore(state => state.showManageParticipantsModal);
  const setShowManageParticipantsModal = useUIStore(state => state.setShowManageParticipantsModal);
  const editingProject = useUIStore(state => state.editingProject);
  const setEditingProject = useUIStore(state => state.setEditingProject);
  const editingWorkspace = useUIStore(state => state.editingWorkspace);
  const setEditingWorkspace = useUIStore(state => state.setEditingWorkspace);
  const deletingProject = useUIStore(state => state.deletingProject);
  const setDeletingProject = useUIStore(state => state.setDeletingProject);
  const deletingWorkspace = useUIStore(state => state.deletingWorkspace);
  const setDeletingWorkspace = useUIStore(state => state.setDeletingWorkspace);

  const { projects, setProjects } = useProjects(user, isAuthReady);
  const projectMemory = useDocumentStore(state => state.projectMemory);
  
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const setCurrentWorkspaceId = useDataStore(state => state.setCurrentWorkspaceId);
  const currentProjectId = useDataStore(state => state.currentProjectId);
  const setCurrentProjectId = useDataStore(state => state.setCurrentProjectId);
  
  const isAiActive = useDocumentStore(state => state.isAiActive);
  const setIsAiActive = useDocumentStore(state => state.setIsAiActive);
  const isZeroTouchMode = useDocumentStore(state => state.isZeroTouchMode);
  const setIsZeroTouchMode = useDocumentStore(state => state.setIsZeroTouchMode);
  const activeZeroTouchRoles = useDocumentStore(state => state.activeZeroTouchRoles);
  const setActiveZeroTouchRoles = useDocumentStore(state => state.setActiveZeroTouchRoles);
  
  const {
    activeUsers,
    typingUsers,
    isLoadingWorkspace,
    documentContent,
    setDocumentContent,
    channelRef,
    messages
  } = useWorkspaceSync(
    currentWorkspaceId,
    setCurrentWorkspaceId,
    user,
    isAuthReady
  );
  const selectedDocumentText = useDocumentStore(state => state.selectedDocumentText);
  const setSelectedDocumentText = useDocumentStore(state => state.setSelectedDocumentText);
  const selectedModel = useSettingsStore(state => state.selectedModel);
  const setSelectedModel = useSettingsStore(state => state.setSelectedModel);
  const theme = useSettingsStore(state => state.theme) as ThemeType;
  const setTheme = useSettingsStore(state => state.setTheme);
  const sessionId = useRef(crypto.randomUUID());

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-monochrome', 'theme-energetic', 'theme-ocean');
    if (theme) {
      root.classList.add(`theme-${theme}`);
    }
    localStorage.setItem('jetwork-theme', theme);
  }, [theme]);



  // Save current project ID
  useEffect(() => {
    if (currentProjectId) {
      localStorage.setItem('jetwork-current-project-id', currentProjectId);
    } else {
      localStorage.removeItem('jetwork-current-project-id');
    }
  }, [currentProjectId]);

  const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);

  const {
    handleNewProject,
    handleNewWorkspace,
    handleEditProject,
    handleDeleteProject,
    handleEditWorkspace,
    handleDeleteWorkspace,
    handleAddParticipant,
    handleRemoveParticipant,
    handleLeaveWorkspace,
    handleToggleReaction
  } = useWorkspaceHandlers(
    user,
    currentWorkspace,
    messages
  );

  const selectWorkspace = useDataStore(state => state.selectWorkspace);
  const selectProject = useDataStore(state => state.selectProject);

  const isGenerating = useDocumentStore(state => state.isGenerating);
  const isDiscussing = useDocumentStore(state => state.isDiscussing);
  const aiHandRaised = useDocumentStore(state => state.aiHandRaised);
  const setAiHandRaised = useDocumentStore(state => state.setAiHandRaised);
  const activeTab = useDocumentStore(state => state.activeTab);
  const setActiveTab = useDocumentStore(state => state.setActiveTab);

  const {
    handleSendMessage,
    handleAcceptAiHandRaise,
    handleGenerateDocument
  } = useMessages(channelRef);

  const handleUpdateDocument = async (newContent: DocumentData) => {
    setDocumentContent(newContent);
    
    if (currentWorkspaceId) {
      try {
        await supabase.from('workspaces').update({ last_updated: nowIso() }).eq('id', currentWorkspaceId);
        await saveDocumentAndVersion(currentWorkspaceId, `manual-${Date.now()}`, newContent);
      } catch (err) {
        console.error("Failed to update document in database:", err);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
      setUser(null);
      useMessageStore.getState().clearAll();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleUpdateUser = async (updatedUser: { name: string; role: string; color?: string }) => {
    if (!user) return;

    const parts = updatedUser.name.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ');

    try {
      const payload: Record<string, any> = {
        name: firstName,
        surname: lastName,
        role: updatedUser.role,
      };
      if (updatedUser.color) payload.color = updatedUser.color;
      const { error } = await supabase.from('users').update(payload).eq('uid', user.uid);
      if (error) throw error;
      setUser(user ? { ...user, ...updatedUser, firstName, lastName } : null);
    } catch (error) {
      console.error("Failed to update user profile:", error);
      alert("Profil güncellenirken bir hata oluştu.");
    }
  };

  const latestScoreMessage = [...messages].reverse().find(m => m.score !== undefined && m.score > 0);
  const latestScore = latestScoreMessage?.score;
  const latestScoreExplanation = latestScoreMessage?.scoreExplanation;

  const setPromptSettings = useSettingsStore(state => state.setPromptSettings);

  useEffect(() => {
    const loadPromptSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('data')
          .eq('id', 'prompts')
          .maybeSingle();
        if (error) throw error;
        if (data?.data) setPromptSettings(data.data as any);
      } catch (error) {
        console.error("Error loading prompt settings:", error);
      }
    };
    if (isAuthReady) {
      loadPromptSettings();
    }
  }, [isAuthReady, setPromptSettings]);

  if (!isAuthReady) {
    return <AuthLoadingState error={authError} onRetry={retryAuth} />;
  }

  if (!user) {
    return <LandingPage />;
  }

  if (!user.onboardingCompleted) {
    return <OnboardingPage user={user} onComplete={(updatedUser) => setUser({ ...updatedUser, onboardingCompleted: true })} />;
  }

  return (
    <div className="flex h-screen bg-theme-bg text-theme-text font-sans overflow-hidden selection:bg-theme-primary selection:text-theme-primary-fg transition-colors duration-300 relative">
      {/* Background Gradient for Glass Effect */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-theme-primary/20 blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-theme-primary/10 blur-[100px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-theme-primary/20 blur-[150px]" />
      </div>
      
      <ModalsContainer
        user={user}
        handleUpdateUser={handleUpdateUser}
        handleNewWorkspace={handleNewWorkspace}
        handleNewProject={handleNewProject}
        handleAddParticipant={handleAddParticipant}
        handleRemoveParticipant={handleRemoveParticipant}
        handleLeaveWorkspace={handleLeaveWorkspace}
        handleEditProject={handleEditProject}
        handleEditWorkspace={handleEditWorkspace}
        handleDeleteProject={handleDeleteProject}
        handleDeleteWorkspace={handleDeleteWorkspace}
      />
      <AISettingsModal />
      {!currentWorkspaceId && (
        <Sidebar 
          user={user}
          onSelectWorkspace={selectWorkspace}
          onSelectProject={selectProject}
          onEditProject={setEditingProject}
          onDeleteProject={setDeletingProject}
          theme={theme}
          onThemeChange={setTheme}
          onLogout={handleLogout}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
      )}
      <MainContent>
        <WorkspaceView
          messages={messages}
          user={user}
          latestScore={latestScore}
          latestScoreExplanation={latestScoreExplanation}
          channelRef={channelRef}
          sessionId={sessionId}
          onSendMessage={handleSendMessage}
          onToggleReaction={handleToggleReaction}
          onToggleAiActive={() => {
            const newValue = !isAiActive;
            setIsAiActive(newValue);
            if (newValue && isZeroTouchMode) {
              setIsZeroTouchMode(false);
            }
          }}
          onToggleZeroTouchMode={() => {
            const newValue = !isZeroTouchMode;
            setIsZeroTouchMode(newValue);
            if (newValue && isAiActive) {
              setIsAiActive(false);
            }
          }}
          onAcceptAiHandRaise={handleAcceptAiHandRaise}
          onDismissAiHandRaise={() => setAiHandRaised(null)}
          onRestoreDocument={handleUpdateDocument}
          onGenerateDocument={handleGenerateDocument}
          onUpdateDocument={handleUpdateDocument}
        />
      </MainContent>
    </div>
  );
}
