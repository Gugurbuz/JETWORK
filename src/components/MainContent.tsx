import React from 'react';
import { Menu, MessageSquarePlus, Plus } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';
import { JetWorkLogo } from './JetWorkLogo';
import { FileLibraryLauncher } from './FileLibrary';
import { SidebarSurfaceEnhancer } from './SidebarSurfaceEnhancer';
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

  return <main className="relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <SidebarSurfaceEnhancer />
    <FileLibraryLauncher />
    {!currentWorkspaceId && <button type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Projeler menüsünü aç"
      className="absolute left-3 top-3 z-30 rounded-xl p-2 text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text md:hidden"><Menu size={20} /></button>}
    {!currentWorkspaceId ? project ? (
      <ProjectDashboard project={project} onSelectWorkspace={selectWorkspace}
        onNewWorkspace={() => setShowNewItemModal(true)} onEditWorkspace={setEditingWorkspace}
        onDeleteWorkspace={setDeletingWorkspace} />
    ) : (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-theme-bg px-6 py-12">
        <div className="w-full max-w-2xl text-center">
          <JetWorkLogo className="mx-auto mb-7 h-11 w-11" />
          <h2 className="text-2xl font-semibold tracking-tight text-theme-text">Bugün ne üzerinde çalışıyoruz?</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-theme-text-muted">
            Bir talebi, sorunu veya fikri yaz. JetWork araştırır, doğrular ve gerektiğinde profesyonel dosyalar üretir.
          </p>
          <button
            type="button"
            onClick={onQuickStart}
            className="mx-auto mt-8 flex h-14 w-full max-w-xl items-center justify-between rounded-2xl border border-theme-border/80 bg-theme-bg px-4 text-left text-sm text-theme-text-muted shadow-[0_8px_28px_rgba(0,0,0,0.06)] transition hover:border-theme-text-muted/40"
          >
            <span>Bir şey sor veya birlikte çalış…</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-theme-text text-theme-bg"><MessageSquarePlus size={15} /></span>
          </button>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
            {['İş analizi oluştur', 'Hata mesajını incele', 'Kaynakları karşılaştır', 'Test senaryosu hazırla'].map(label => (
              <button key={label} type="button" onClick={onQuickStart} className="rounded-full border border-theme-border/70 px-3 py-2 text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text">
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowNewProjectModal(true)} data-testid="open-new-project" className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-theme-text-muted transition hover:text-theme-text"><Plus size={14} /> Yeni proje oluştur</button>
        </div>
      </div>
    ) : children}
  </main>;
}
