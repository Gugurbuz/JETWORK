import React from 'react';
import { LayoutDashboard, Menu, MessageSquarePlus } from 'lucide-react';
import { motion } from 'motion/react';
import { ProjectDashboard } from './ProjectDashboard';
import { JetWorkLogo } from './JetWorkLogo';
import { useDataStore } from '../store/useDataStore';
import { useUIStore } from '../store/useUIStore';

interface MainContentProps { children: React.ReactNode; onQuickStart: () => void; }

const floatingLogos = [
  { left: '7%', top: '16%', size: 42, duration: 7.5, delay: 0.2, drift: 34, direction: 1 },
  { left: '18%', top: '68%', size: 58, duration: 9.5, delay: 0.8, drift: 46, direction: -1 },
  { left: '31%', top: '25%', size: 34, duration: 8.25, delay: 1.4, drift: 32, direction: -1 },
  { left: '42%', top: '78%', size: 46, duration: 10.5, delay: 0.5, drift: 42, direction: 1 },
  { left: '57%', top: '14%', size: 52, duration: 9.25, delay: 1.1, drift: 44, direction: 1 },
  { left: '69%', top: '66%', size: 36, duration: 8.75, delay: 1.8, drift: 34, direction: -1 },
  { left: '82%', top: '22%', size: 64, duration: 11, delay: 0.35, drift: 52, direction: -1 },
  { left: '91%', top: '73%', size: 44, duration: 9, delay: 1.55, drift: 38, direction: 1 },
];

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
      className="absolute left-3 top-3 z-30 rounded-lg border border-theme-border bg-theme-surface p-2 text-theme-text-muted md:hidden"><Menu size={20} /></button>}
    {!currentWorkspaceId ? project ? (
      <ProjectDashboard project={project} onSelectWorkspace={selectWorkspace}
        onNewWorkspace={() => setShowNewItemModal(true)} onEditWorkspace={setEditingWorkspace}
        onDeleteWorkspace={setDeletingWorkspace} />
    ) : (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-theme-bg p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {floatingLogos.map((logo, index) => {
            const direction = logo.direction;
            const drift = logo.drift;

            return (
              <motion.div
                key={index}
                className="absolute opacity-[0.1] blur-[0.15px]"
                style={{
                  left: logo.left,
                  top: logo.top,
                  width: logo.size,
                  height: logo.size,
                  willChange: 'transform',
                  transformOrigin: 'center',
                }}
                initial={false}
                animate={{
                  x: [0, drift * 0.45 * direction, drift * direction, drift * 0.25 * direction, 0],
                  y: [0, drift * -0.7, drift * -0.15, drift * 0.55, 0],
                  rotate: [-5 * direction, 4 * direction, 9 * direction, -2 * direction, -5 * direction],
                  scale: [1, 1.055, 0.985, 1.035, 1],
                }}
                transition={{
                  duration: logo.duration,
                  delay: logo.delay,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  repeatType: 'loop',
                }}
              >
                <JetWorkLogo className="h-full w-full drop-shadow-[0_10px_22px_rgba(0,0,0,0.12)]" />
              </motion.div>
            );
          })}
        </div>

        <div className="relative z-10 text-center">
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
