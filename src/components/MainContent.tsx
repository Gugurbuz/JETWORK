import React from 'react';
import { LayoutDashboard } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';
import { useStore } from '../store/useStore';

interface MainContentProps {
  children: React.ReactNode;
}

export function MainContent({
  children
}: MainContentProps) {
  const currentWorkspaceId = useStore(state => state.currentWorkspaceId);
  const currentProjectId = useStore(state => state.currentProjectId);
  const projects = useStore(state => state.projects);
  const setShowNewItemModal = useStore(state => state.setShowNewItemModal);
  const setEditingWorkspace = useStore(state => state.setEditingWorkspace);
  const setDeletingWorkspace = useStore(state => state.setDeletingWorkspace);
  const setShowNewProjectModal = useStore(state => state.setShowNewProjectModal);
  const selectWorkspace = useStore(state => state.selectWorkspace);

  return (
    <main className="flex-1 flex relative z-10">
      {!currentWorkspaceId ? (
        currentProjectId && projects.find(p => p.id === currentProjectId) ? (
          <ProjectDashboard 
            project={projects.find(p => p.id === currentProjectId)!}
            onSelectWorkspace={selectWorkspace}
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
        children
      )}
    </main>
  );
}
