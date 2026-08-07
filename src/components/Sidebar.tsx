import React from 'react';
import {
  Archive, ChevronDown, ChevronLeft, ChevronRight, FileText, FolderPlus,
  Loader2, LogOut, MessageSquarePlus, Plus, RefreshCw, RotateCcw, Search,
  Settings, Trash2, User,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Project } from '../types';
import { cn } from '../lib/utils';
import { useDataStore } from '../store/useDataStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

export type ThemeType = 'monochrome' | 'energetic' | 'ocean';
type Lifecycle = 'active' | 'archived' | 'trash';

interface SidebarProps {
  user: { uid: string; name: string; role: string; color?: string } | null;
  onSelectWorkspace: (id: string) => void;
  onSelectProject: (id: string) => void;
  onQuickStart?: () => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (id: string) => void;
  onArchiveProject?: (id: string) => void;
  onRestoreProject?: (id: string) => void;
  isLoadingProjects?: boolean;
  projectsError?: string | null;
  onRetryProjects?: () => void;
  theme: ThemeType;
  onThemeChange: (theme: ThemeType) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
}

const PAGE_SIZE = 30;
const SIDEBAR_COLLAPSED_KEY = 'jetwork:global-sidebar:collapsed';

const readCollapsedPreference = (): boolean => {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};

const SwissLogo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="JetWork">
    <rect width="32" height="32" fill="#FFC107" />
    <rect x="8" y="8" width="16" height="16" fill="var(--theme-surface)" />
    <rect x="12" y="12" width="8" height="8" fill="#FF9800" />
  </svg>
);

export function Sidebar(props: SidebarProps) {
  const {
    user, onSelectWorkspace, onSelectProject, onQuickStart, onDeleteProject,
    onArchiveProject, onRestoreProject, isLoadingProjects, projectsError,
    onRetryProjects, theme, onThemeChange, onLogout, onOpenSettings,
  } = props;
  const projects = useDataStore(state => state.projects);
  const currentProjectId = useDataStore(state => state.currentProjectId);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const mobileOpen = useUIStore(state => state.mobileSidebarOpen);
  const setMobileOpen = useUIStore(state => state.setMobileSidebarOpen);
  const selectedModel = useSettingsStore(state => state.selectedModel);
  const setSelectedModel = useSettingsStore(state => state.setSelectedModel);

  const [collapsed, setCollapsed] = React.useState(readCollapsedPreference);
  const [scope, setScope] = React.useState<'owned' | 'shared'>('owned');
  const [lifecycle, setLifecycle] = React.useState<Lifecycle>('active');
  const [query, setQuery] = React.useState('');
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // A mobile drawer is always full width even when the desktop rail is collapsed.
  const compact = collapsed && !mobileOpen;
  const activeProject = React.useMemo(
    () => projects.find(project => project.workspaces.some(workspace => workspace.id === currentWorkspaceId)),
    [currentWorkspaceId, projects],
  );
  const activeWorkspace = React.useMemo(
    () => activeProject?.workspaces.find(workspace => workspace.id === currentWorkspaceId),
    [activeProject, currentWorkspaceId],
  );

  React.useEffect(() => setVisibleCount(PAGE_SIZE), [scope, lifecycle, query]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Sidebar still works if local storage is unavailable.
    }
  }, [collapsed]);

  React.useEffect(() => {
    if (!activeProject) return;
    setExpanded(previous => ({ ...previous, [activeProject.id]: true }));
    setScope(activeProject.ownerId === user?.uid ? 'owned' : 'shared');
    setLifecycle(activeProject.deletedAt ? 'trash' : activeProject.archivedAt ? 'archived' : 'active');
  }, [activeProject, user?.uid]);

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return projects.filter(project => {
      const owned = project.ownerId === user?.uid;
      if ((scope === 'owned') !== owned) return false;
      if (lifecycle === 'trash' ? !project.deletedAt : project.deletedAt) return false;
      if (lifecycle === 'archived' ? !project.archivedAt : lifecycle === 'active' && project.archivedAt) return false;
      if (!normalized) return true;
      return [project.name, project.description, ...project.workspaces.map(workspace => workspace.title)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(normalized);
    });
  }, [projects, query, scope, lifecycle, user?.uid]);

  const runMobileAction = React.useCallback((action: () => void) => {
    if (mobileOpen) setMobileOpen(false);
    action();
  }, [mobileOpen, setMobileOpen]);

  const selectProject = (id: string) => {
    runMobileAction(() => onSelectProject(id));
  };
  const selectWorkspace = (id: string) => {
    runMobileAction(() => onSelectWorkspace(id));
  };
  const canManage = (project: Project) => project.ownerId === user?.uid;

  const expandForSearch = () => {
    setCollapsed(false);
    window.setTimeout(() => searchInputRef.current?.focus(), 180);
  };

  const startNewChat = () => {
    runMobileAction(() => onQuickStart?.());
  };

  const openNewProject = () => {
    runMobileAction(() => setShowNewProjectModal(true));
  };

  const openSettings = () => {
    runMobileAction(() => {
      setShowUserMenu(false);
      onOpenSettings();
    });
  };

  const compactActionClass = 'relative flex h-11 w-11 items-center justify-center rounded-xl text-theme-text-muted transition hover:bg-theme-surface-hover hover:text-theme-text';

  const content = (
    <motion.aside
      initial={false}
      animate={{ width: compact ? 72 : 280 }}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col border-r border-theme-border bg-theme-bg shadow-xl transition-transform md:relative md:z-20 md:shadow-none',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed(previous => !previous)}
        className="absolute -right-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border border-theme-border bg-theme-surface text-theme-text-muted shadow-sm transition hover:text-theme-text md:flex"
        aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
        title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      <div className={cn('flex h-16 items-center border-b border-theme-border', compact ? 'justify-center px-0' : 'gap-3 px-5')}>
        <div className="h-8 w-8 shrink-0"><SwissLogo /></div>
        {!compact && <span className="font-bold text-theme-text">JetWork</span>}
      </div>

      {compact ? (
        <div className="flex flex-1 flex-col items-center gap-1 py-4">
          <button type="button" onClick={startNewChat} className={compactActionClass} title="Yeni sohbet" aria-label="Yeni sohbet">
            <MessageSquarePlus size={20} />
          </button>
          <button type="button" onClick={expandForSearch} className={compactActionClass} title="Ara" aria-label="Ara">
            <Search size={20} />
          </button>
          <button type="button" onClick={() => setCollapsed(false)} className={compactActionClass} title="Projeler" aria-label="Projeler">
            <FolderPlus size={20} />
          </button>
          {activeWorkspace && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className={cn(compactActionClass, 'mt-2 bg-theme-primary/10 text-theme-primary')}
              title={activeWorkspace.title}
              aria-label={`Aktif sohbet: ${activeWorkspace.title}`}
            >
              <FileText size={20} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-theme-primary" />
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3 border-b border-theme-border p-4">
            <button
              type="button"
              onClick={startNewChat}
              className="flex w-full items-center gap-2 rounded-lg border border-theme-border bg-theme-surface px-3 py-2.5 text-sm font-semibold text-theme-text transition hover:bg-theme-surface-hover"
            >
              <MessageSquarePlus size={16} className="text-theme-primary" /> Yeni sohbet
            </button>

            <div className="grid grid-cols-2 rounded-lg border border-theme-border bg-theme-surface p-1 text-xs">
              {(['owned', 'shared'] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  className={cn('rounded-md py-1.5', scope === value && 'bg-theme-surface-hover font-semibold')}
                >
                  {value === 'owned' ? 'Projelerim' : 'Paylaşılanlar'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              {([['active', 'Aktif'], ['archived', 'Arşiv'], ['trash', 'Çöp']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLifecycle(value)}
                  className={cn('rounded-md border border-theme-border px-1 py-1.5', lifecycle === value && 'border-theme-primary text-theme-primary')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-theme-text-muted" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Proje veya sohbet ara"
                className="w-full rounded-md border border-theme-border bg-theme-surface py-2 pl-9 pr-3 text-xs outline-none focus:border-theme-primary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-bold text-theme-text-muted">
              <span>{lifecycle === 'active' ? 'PROJELER' : lifecycle === 'archived' ? 'ARŞİV' : 'ÇÖP KUTUSU'}</span>
              {scope === 'owned' && lifecycle === 'active' && (
                <button type="button" onClick={openNewProject} aria-label="Yeni proje"><Plus size={15} /></button>
              )}
            </div>

            {projectsError && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
                <p>Projeler yüklenemedi.</p>
                <button type="button" onClick={onRetryProjects} className="mt-2 flex items-center gap-1 font-semibold"><RefreshCw size={12} />Tekrar dene</button>
              </div>
            )}
            {isLoadingProjects && projects.length === 0 && <Loader2 className="mx-auto mt-6 animate-spin text-theme-text-muted" size={18} />}

            <div className="space-y-1">
              {filtered.slice(0, visibleCount).map(project => {
                const isProjectActive = currentProjectId === project.id || activeProject?.id === project.id;
                return (
                  <div key={project.id} className={cn('group relative rounded-lg', isProjectActive ? 'bg-theme-primary/5' : 'hover:bg-theme-surface')}>
                    <div className="flex items-center gap-1 p-1.5">
                      <button
                        type="button"
                        onClick={() => setExpanded(state => ({ ...state, [project.id]: !state[project.id] }))}
                        className="p-1"
                        aria-label={`${project.name} sohbetlerini ${expanded[project.id] ? 'daralt' : 'genişlet'}`}
                      >
                        <ChevronRight size={14} className={cn('transition-transform', expanded[project.id] && 'rotate-90')} />
                      </button>
                      <button
                        type="button"
                        onClick={() => selectProject(project.id)}
                        className={cn('flex min-w-0 flex-1 items-center gap-2 text-left', isProjectActive && 'text-theme-primary')}
                      >
                        <FolderPlus size={16} className="shrink-0" />
                        <span className="truncate text-sm font-medium">{project.name}</span>
                      </button>
                      {canManage(project) && (
                        <div className="flex items-center opacity-0 transition group-hover:opacity-100">
                          {lifecycle === 'active' && <button type="button" onClick={() => onArchiveProject?.(project.id)} className="p-1.5" title="Arşivle"><Archive size={12} /></button>}
                          {lifecycle !== 'active' && <button type="button" onClick={() => onRestoreProject?.(project.id)} className="p-1.5 text-emerald-600" title="Geri yükle"><RotateCcw size={12} /></button>}
                          {lifecycle !== 'trash' && <button type="button" onClick={() => onDeleteProject?.(project.id)} className="p-1.5 text-red-500" title="Çöp kutusuna taşı"><Trash2 size={12} /></button>}
                        </div>
                      )}
                    </div>

                    {expanded[project.id] && (
                      <div className="mb-2 ml-8 border-l border-theme-border pl-2">
                        {project.workspaces.filter(workspace => !workspace.deletedAt && !workspace.archivedAt).map(workspace => (
                          <button
                            type="button"
                            key={workspace.id}
                            onClick={() => selectWorkspace(workspace.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-theme-text-muted transition hover:bg-theme-surface-hover',
                              currentWorkspaceId === workspace.id && 'bg-theme-primary/10 font-semibold text-theme-primary',
                            )}
                          >
                            <FileText size={12} />
                            <span className="truncate">{workspace.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && !isLoadingProjects && (
              <div className="mt-4 rounded-lg border border-dashed border-theme-border p-4 text-center text-xs text-theme-text-muted">Bu görünümde proje yok.</div>
            )}
            {filtered.length > visibleCount && (
              <button type="button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)} className="mt-3 flex w-full items-center justify-center gap-1 rounded-md border border-theme-border py-2 text-xs font-semibold">
                <ChevronDown size={14} /> Daha fazla ({filtered.length - visibleCount})
              </button>
            )}
          </div>
        </>
      )}

      <div className={cn('relative border-t border-theme-border', compact ? 'flex justify-center p-3' : 'p-4')}>
        <button
          type="button"
          onClick={() => {
            if (compact) setCollapsed(false);
            else setShowUserMenu(previous => !previous);
          }}
          className={cn('flex items-center rounded-lg hover:bg-theme-surface', compact ? 'justify-center p-1' : 'w-full gap-3 p-2')}
          title={compact ? `${user?.name || 'Profil'} — menüyü aç` : undefined}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-theme-primary text-xs font-bold text-theme-primary-fg">
            {user?.name?.charAt(0) || 'U'}
          </div>
          {!compact && (
            <>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-bold">{user?.name}</p>
                <p className="truncate text-[10px] text-theme-text-muted">{user?.role}</p>
              </div>
              <Settings size={14} />
            </>
          )}
        </button>

        {showUserMenu && !compact && (
          <div className="absolute bottom-full left-4 right-4 mb-2 max-h-[70vh] overflow-y-auto rounded-lg border border-theme-border bg-theme-surface p-2 shadow-xl">
            <button type="button" onClick={openSettings} className="flex w-full items-center gap-2 rounded p-2 text-xs hover:bg-theme-surface-hover"><User size={14} />Profil ve ayarlar</button>
            <div className="my-1 border-t border-theme-border pt-2">
              <label htmlFor="sidebar-ai-model" className="mb-1.5 block px-1 text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">Yapay Zeka Modeli</label>
              <select
                id="sidebar-ai-model"
                value={selectedModel}
                onChange={event => setSelectedModel(event.target.value)}
                className="w-full rounded-md border border-theme-border bg-theme-bg px-2 py-2 text-xs text-theme-text outline-none focus:border-theme-primary"
              >
                <option value="auto">Otomatik — OpenAI + Gemini</option>
                <option value="gpt-5.6-sol">OpenAI GPT-5.6 Sol</option>
                <option value="gpt-5.6">OpenAI GPT-5.6</option>
                <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite</option>
              </select>
            </div>
            <div className="my-1 border-t border-theme-border pt-2">
              <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted">Tema</p>
              <div className="grid grid-cols-3 gap-1">
                {(['monochrome', 'energetic', 'ocean'] as const).map(themeName => (
                  <button
                    type="button"
                    key={themeName}
                    onClick={() => onThemeChange(themeName)}
                    className={cn('rounded border p-1 text-[9px]', theme === themeName ? 'border-theme-primary' : 'border-theme-border')}
                  >
                    {themeName}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" onClick={onLogout} className="flex w-full items-center gap-2 rounded p-2 text-xs text-red-500 hover:bg-red-500/10"><LogOut size={14} />Çıkış yap</button>
          </div>
        )}
      </div>
    </motion.aside>
  );

  return (
    <>
      {mobileOpen && (
        <button type="button" aria-label="Menüyü kapat" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/50 md:hidden" />
      )}
      {content}
    </>
  );
}
