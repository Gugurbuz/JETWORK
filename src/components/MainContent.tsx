import React from 'react';
import { LayoutDashboard } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';
import { useDataStore } from '../store/useDataStore';
import { useUIStore } from '../store/useUIStore';

interface MainContentProps {
  children: React.ReactNode;
}

export function MainContent({
  children
}: MainContentProps) {
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const currentProjectId = useDataStore(state => state.currentProjectId);
  const projects = useDataStore(state => state.projects);
  const setShowNewItemModal = useUIStore(state => state.setShowNewItemModal);
  const setEditingWorkspace = useUIStore(state => state.setEditingWorkspace);
  const setDeletingWorkspace = useUIStore(state => state.setDeletingWorkspace);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const selectWorkspace = useDataStore(state => state.selectWorkspace);

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
                  aria-label="Open new project dialog"
                  data-testid="open-new-project"
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
