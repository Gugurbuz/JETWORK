import React from 'react';
import { LayoutDashboard, Menu, MessageSquarePlus } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';
import { useDataStore } from '../store/useDataStore';
import { useUIStore } from '../store/useUIStore';

interface MainContentProps { children: React.ReactNode; onQuickStart: () => void; }

export function MainContent({ children, onQuickStart }: MainContentProps) {
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const currentProjectId = useDataStore(state => state.currentProjectId);
  const projects = useDataStore(state => state.projects);
  const setShowNewItemModal = useUIStore(state => state.setShowNewItemModal);
  const setEditingWorkspace = useUIStore(state => state.setEditingWorkspace);
  const setDeletingWorkspace = useUIStore(state => state.setDeletingWorkspace);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const setMobileSidebarOpen = useUIStore(state => state.setMobileSidebarOpen);
  const selectWorkspace = useDataStore(state => state.selectWorkspace);
  const project = projects.find(item => item.id === currentProjectId);

  return <main className="relative z-10 flex min-w-0 flex-1">
    {!currentWorkspaceId && <button type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Projeler menüsünü aç"
      className="absolute left-3 top-3 z-30 rounded-lg border border-theme-border bg-theme-surface p-2 text-theme-text md:hidden"><Menu size={20} /></button>}
    {!currentWorkspaceId ? project ? (
      <ProjectDashboard project={project} onSelectWorkspace={selectWorkspace}
        onNewWorkspace={() => setShowNewItemModal(true)} onEditWorkspace={setEditingWorkspace}
        onDeleteWorkspace={setDeletingWorkspace} />
    ) : (
      <div className="flex flex-1 items-center justify-center bg-theme-bg p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-theme-border bg-theme-surface text-theme-text-muted"><LayoutDashboard size={32} /></div>
          <h2 className="mb-2 text-xl font-bold text-theme-text">JetWork'e Hoş Geldiniz</h2>
          <p className="mb-6 text-theme-text-muted">Doğrudan sohbet başlatın veya çalışmalarınızı proje altında düzenleyin.</p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={onQuickStart} className="inline-flex items-center gap-2 rounded-md bg-theme-primary px-5 py-2.5 text-sm font-semibold text-theme-primary-fg hover:bg-theme-primary-hover"><MessageSquarePlus size={17} />Yeni Sohbet</button>
            <button type="button" onClick={() => setShowNewProjectModal(true)} data-testid="open-new-project" className="rounded-md border border-theme-border bg-theme-surface px-5 py-2.5 text-sm font-semibold text-theme-text hover:bg-theme-surface-hover">Yeni Proje</button>
          </div>
        </div>
      </div>
    ) : children}
  </main>;
}
