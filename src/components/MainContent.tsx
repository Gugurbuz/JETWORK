import React, { useEffect, useRef } from 'react';
import { Menu, MessageSquarePlus } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';
import { JetWorkLogo } from './JetWorkLogo';
import { useDataStore } from '../store/useDataStore';
import { useUIStore } from '../store/useUIStore';

interface MainContentProps { children: React.ReactNode; onQuickStart: () => void; }

interface FloatingLogoConfig {
  left: string;
  top: string;
  size: number;
  duration: number;
  phase: number;
  driftX: number;
  driftY: number;
  direction: 1 | -1;
}

const floatingLogos: FloatingLogoConfig[] = [
  { left: '5%', top: '13%', size: 42, duration: 6.2, phase: 0.2, driftX: 105, driftY: 70, direction: 1 },
  { left: '16%', top: '66%', size: 58, duration: 7.8, phase: 1.1, driftX: 125, driftY: 82, direction: -1 },
  { left: '29%', top: '22%', size: 34, duration: 5.6, phase: 2.3, driftX: 92, driftY: 62, direction: -1 },
  { left: '41%', top: '76%', size: 46, duration: 7.1, phase: 0.7, driftX: 118, driftY: 76, direction: 1 },
  { left: '55%', top: '12%', size: 52, duration: 6.8, phase: 1.8, driftX: 132, driftY: 86, direction: 1 },
  { left: '68%', top: '64%', size: 36, duration: 5.9, phase: 2.8, driftX: 98, driftY: 68, direction: -1 },
  { left: '80%', top: '19%', size: 64, duration: 8.2, phase: 0.45, driftX: 145, driftY: 92, direction: -1 },
  { left: '89%', top: '71%', size: 44, duration: 6.5, phase: 2.1, driftX: 110, driftY: 74, direction: 1 },
];

function FloatingLogo({ logo }: { logo: FloatingLogoConfig }) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    let frameId = 0;
    const startedAt = performance.now();
    const durationMs = logo.duration * 1000;

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const t = (elapsed / durationMs) * Math.PI * 2 + logo.phase;
      const direction = logo.direction;

      const x = (
        Math.sin(t) * logo.driftX * 0.62 +
        Math.sin(t * 0.47 + 1.4) * logo.driftX * 0.38
      ) * direction;
      const y = (
        Math.cos(t * 0.83) * logo.driftY * 0.58 +
        Math.sin(t * 0.41 + 0.8) * logo.driftY * 0.42
      );
      const rotate = Math.sin(t * 0.72) * 12 * direction;
      const scale = 1 + Math.sin(t * 1.13) * 0.055;

      element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rotate.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [logo]);

  return (
    <div
      ref={elementRef}
      data-testid="floating-jetwork-logo"
      className="absolute opacity-[0.11] blur-[0.15px]"
      style={{
        left: logo.left,
        top: logo.top,
        width: logo.size,
        height: logo.size,
        willChange: 'transform',
        transformOrigin: 'center',
      }}
    >
      <JetWorkLogo className="h-full w-full drop-shadow-[0_10px_22px_rgba(0,0,0,0.12)]" />
    </div>
  );
}

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
    {!currentWorkspaceId && <button type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Projeler menüsünü aç"
      className="absolute left-3 top-3 z-30 rounded-lg border border-theme-border bg-theme-surface p-2 text-theme-text-muted md:hidden"><Menu size={20} /></button>}
    {!currentWorkspaceId ? project ? (
      <ProjectDashboard project={project} onSelectWorkspace={selectWorkspace}
        onNewWorkspace={() => setShowNewItemModal(true)} onEditWorkspace={setEditingWorkspace}
        onDeleteWorkspace={setDeletingWorkspace} />
    ) : (
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-theme-bg p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {floatingLogos.map((logo, index) => (
            <React.Fragment key={index}>
              <FloatingLogo logo={logo} />
            </React.Fragment>
          ))}
        </div>

        <div className="relative z-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-theme-border bg-theme-surface shadow-sm">
            <JetWorkLogo className="h-10 w-10" />
          </div>
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
