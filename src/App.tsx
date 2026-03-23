import React, { useState, useRef, useEffect } from 'react';
import { Sidebar, ThemeType } from './components/Sidebar';
import { ModalsContainer } from './components/ModalsContainer';
import { WorkspaceView } from './components/WorkspaceView';
import { MainContent } from './components/MainContent';
import { LandingPage } from './components/LandingPage';
import { OnboardingPage } from './components/OnboardingPage';
import { ProjectDashboard } from './components/ProjectDashboard';
import { Message, Project, Workspace, Collaborator, DocumentData, ActiveUser, TypingUser, Question } from './types';
import { ChatResponseSchema, chatResponseJsonSchema, discussionJsonSchema } from './schemas';
import { LayoutDashboard } from 'lucide-react';
import { marked } from 'marked';
import { parse as parsePartialJson } from 'partial-json';
import { GoogleGenAI } from "@google/genai";
import { auth, db, onAuthStateChanged, doc, getDocFromServer, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, onSnapshot, query, orderBy, where, getDocs, arrayUnion, arrayRemove, logOut } from './db';
import { useMessageStore } from './store/useMessageStore';
import { useStore } from './store/useStore';
import { supabase } from './supabase';
import { saveDocumentAndVersion, saveRawResponse, parseBusinessAnalysis } from './utils/documentUtils';
import { callGemini, callAiWithRetry } from './services/aiService';
import { MOCK_COLLABORATORS, ZERO_TOUCH_AGENTS, SYSTEM_INSTRUCTION } from './constants';
import { useAI } from './hooks/useAI';
import { useAuth } from './hooks/useAuth';
import { useProjects } from './hooks/useProjects';
import { useWorkspaceSync } from './hooks/useWorkspaceSync';
import { useWorkspaceHandlers } from './hooks/useWorkspaceHandlers';

export default function App() {
  // NOTE: This application uses a hybrid architecture:
  // - Database: Real-time collaborative database (workspaces, messages, projects)
  // - Supabase: Authentication and AI Edge Functions (Gemini agent)
  // - SQLite: Local persistence for shared analyses and memory
  const { user, setUser, isAuthReady } = useAuth();

  const showNewItemModal = useStore(state => state.showNewItemModal);
  const setShowNewItemModal = useStore(state => state.setShowNewItemModal);
  const showNewProjectModal = useStore(state => state.showNewProjectModal);
  const setShowNewProjectModal = useStore(state => state.setShowNewProjectModal);
  const showSettingsModal = useStore(state => state.showSettingsModal);
  const setShowSettingsModal = useStore(state => state.setShowSettingsModal);
  const showManageParticipantsModal = useStore(state => state.showManageParticipantsModal);
  const setShowManageParticipantsModal = useStore(state => state.setShowManageParticipantsModal);
  const editingProject = useStore(state => state.editingProject);
  const setEditingProject = useStore(state => state.setEditingProject);
  const editingWorkspace = useStore(state => state.editingWorkspace);
  const setEditingWorkspace = useStore(state => state.setEditingWorkspace);
  const deletingProject = useStore(state => state.deletingProject);
  const setDeletingProject = useStore(state => state.setDeletingProject);
  const deletingWorkspace = useStore(state => state.deletingWorkspace);
  const setDeletingWorkspace = useStore(state => state.setDeletingWorkspace);

  const { projects, setProjects } = useProjects(user, isAuthReady);
  const projectMemory = useStore(state => state.projectMemory);
  
  const currentWorkspaceId = useStore(state => state.currentWorkspaceId);
  const setCurrentWorkspaceId = useStore(state => state.setCurrentWorkspaceId);
  const currentProjectId = useStore(state => state.currentProjectId);
  const setCurrentProjectId = useStore(state => state.setCurrentProjectId);
  
  const isAiActive = useStore(state => state.isAiActive);
  const setIsAiActive = useStore(state => state.setIsAiActive);
  const isZeroTouchMode = useStore(state => state.isZeroTouchMode);
  const setIsZeroTouchMode = useStore(state => state.setIsZeroTouchMode);
  const activeZeroTouchRoles = useStore(state => state.activeZeroTouchRoles);
  const setActiveZeroTouchRoles = useStore(state => state.setActiveZeroTouchRoles);
  
  const {
    activeUsers,
    typingUsers,
    isLoadingWorkspace,
    documentContent,
    setDocumentContent,
    channelRef,
    messages,
    setMessages
  } = useWorkspaceSync(
    currentWorkspaceId,
    setCurrentWorkspaceId,
    user,
    isAuthReady
  );
  const selectedDocumentText = useStore(state => state.selectedDocumentText);
  const setSelectedDocumentText = useStore(state => state.setSelectedDocumentText);
  const selectedModel = useStore(state => state.selectedModel);
  const setSelectedModel = useStore(state => state.setSelectedModel);
  const theme = useStore(state => state.theme) as ThemeType;
  const setTheme = useStore(state => state.setTheme);
  const sessionId = useRef(Math.random().toString(36).substring(7));

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

  // Save messages to cache
  useEffect(() => {
    if (currentWorkspaceId && messages.length > 0) {
      localStorage.setItem(`jetwork_messages_${currentWorkspaceId}`, JSON.stringify(messages));
    }
  }, [messages, currentWorkspaceId]);

  // Save document to cache
  useEffect(() => {
    if (currentWorkspaceId && documentContent) {
      localStorage.setItem(`jetwork_document_${currentWorkspaceId}`, JSON.stringify(documentContent));
    }
  }, [documentContent, currentWorkspaceId]);

  // Restore active workspace state on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');

    if (shareId && user) {
      // Fetch shared workspace
      const fetchShared = async () => {
        try {
          const shareRef = doc(db, 'shared_analyses', shareId);
          const shareSnap = await getDocFromServer(shareRef);
          
          if (shareSnap.exists()) {
            const data = shareSnap.data();
            const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
            
            // Check if default project exists, if not create it
            const defaultProjectRef = doc(db, 'projects', 'default-project');
            const defaultProjectSnap = await getDocFromServer(defaultProjectRef);
            
            if (!defaultProjectSnap.exists()) {
              await setDoc(defaultProjectRef, {
                name: 'Varsayılan Proje',
                description: '',
                ownerId: user.uid,
                createdAt: serverTimestamp(),
                lastUpdated: serverTimestamp()
              });
            }

            // Create the workspace
            await setDoc(doc(db, 'workspaces', newId), {
              projectId: 'default-project',
              issueKey: generateItemCode(),
              title: 'Paylaşılan Çalışma Alanı',
              type: 'Development',
              status: 'Draft',
              ownerId: user.uid,
              collaborators: MOCK_COLLABORATORS,
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp()
            });
            
            // Save document
            if (data.data) {
              await saveDocumentAndVersion(newId, 'initial', data.data);
            }
            
            setCurrentWorkspaceId(newId);
            setDocumentContent(data.data);
            
            // Remove shareId from URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (err) {
          console.error("Failed to load shared workspace:", err);
        }
      };
      fetchShared();
      return;
    }

    if (currentWorkspaceId && projects.length > 0) {
      const workspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);
      if (workspace) {
        // We now fetch messages from the server in the other useEffect
        // setMessages(workspace.messages || []);
        // setDocumentContent(workspace.document || null);
      }
    }
  }, []);

  const generateItemCode = () => `JET-${Math.floor(Math.random() * 900) + 100}`;

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

  const selectWorkspace = useStore(state => state.selectWorkspace);
  const selectProject = useStore(state => state.selectProject);

  const {
    isGenerating,
    isDiscussing,
    aiHandRaised,
    setAiHandRaised,
    activeTab,
    setActiveTab,
    handleSendMessage,
    handleAcceptAiHandRaise,
    handleGenerateDocument
  } = useAI(
    currentWorkspaceId,
    user,
    messages,
    setMessages,
    channelRef
  );

  const handleUpdateDocument = async (newContent: DocumentData) => {
    setDocumentContent(newContent);
    
    if (currentWorkspaceId) {
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
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

  const handleUpdateUser = async (updatedUser: { name: string; role: string }) => {
    if (!user) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: updatedUser.name,
        role: updatedUser.role
      });
      setUser(prev => prev ? { ...prev, ...updatedUser } : null);
    } catch (error) {
      console.error("Failed to update user profile:", error);
      alert("Profil güncellenirken bir hata oluştu.");
    }
  };

  const latestScoreMessage = [...messages].reverse().find(m => m.score !== undefined && m.score > 0);
  const latestScore = latestScoreMessage?.score;
  const latestScoreExplanation = latestScoreMessage?.scoreExplanation;

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-theme-bg text-theme-text">Yükleniyor...</div>;
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
