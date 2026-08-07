import React from 'react';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  User,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Project, Workspace } from '../types';
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
const RECENT_CHAT_LIMIT = 7;
const SIDEBAR_COLLAPSED_KEY = 'jetwork:global-sidebar:collapsed';

const readCollapsedPreference = (): boolean => {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};

const SwissLogo = ({ compact = false }: { compact?: boolean }) => (
  <svg
    width={compact ? 26 : 28}
    height={compact ? 26 : 28}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="JetWork"
  >
    <rect width="32" height="32" rx="7" fill="#FFC107" />
    <rect x="8" y="8" width="16" height="16" rx="2" fill="var(--theme-surface)" />
    <rect x="12" y="12" width="8" height="8" rx="1" fill="#FF9800" />
  </svg>
);

const lifecycleLabel: Record<Lifecycle, string> = {
  active: 'Aktif',
  archived: 'Arşiv',
  trash: 'Çöp',
};

export function Sidebar(props: SidebarProps) {
  const {
    user,
    onSelectWorkspace,
    onSelectProject,
    onQuickStart,
    onDeleteProject,
    onArchiveProject,
    onRestoreProject,
    isLoadingProjects,
    projectsError,
    onRetryProjects,
    theme,
    onThemeChange,
    onLogout,
    onOpenSettings,
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
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [showFilters, setShowFilters] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // A mobile drawer is always expanded even if the desktop rail is collapsed.
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
      // Sidebar remains usable when local storage is blocked.
    }
  }, [collapsed]);

  React.useEffect(() => {
    if (!activeProject) return;
    setExpanded(previous => ({ ...previous, [activeProject.id]: true }));
    setScope(activeProject.ownerId === user?.uid ? 'owned' : 'shared');
    setLifecycle(activeProject.deletedAt ? 'trash' : activeProject.archivedAt ? 'archived' : 'active');
  }, [activeProject, user?.uid]);

  const projectMatchesScopeAndLifecycle = React.useCallback((project: Project) => {
    const owned = project.ownerId === user?.uid;
    if ((scope === 'owned') !== owned) return false;
    if (lifecycle === 'trash') return Boolean(project.deletedAt);
    if (project.deletedAt) return false;
    if (lifecycle === 'archived') return Boolean(project.archivedAt);
    return !project.archivedAt;
  }, [lifecycle, scope, user?.uid]);

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return projects.filter(project => {
      if (!projectMatchesScopeAndLifecycle(project)) return false;
      if (!normalized) return true;
      return [project.name, project.description, ...project.workspaces.map(workspace => workspace.title)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(normalized);
    });
  }, [projectMatchesScopeAndLifecycle, projects, query]);

  const recentWorkspaces = React.useMemo(() => {
    const rows: Array<{ workspace: Workspace; project: Project }> = [];
    projects.forEach(project => {
      const owned = project.ownerId === user?.uid;
      if ((scope === 'owned') !== owned || project.deletedAt || project.archivedAt) return;
      project.workspaces.forEach(workspace => {
        if (!workspace.deletedAt && !workspace.archivedAt) rows.push({ workspace, project });
      });
    });
    return rows
      .sort((a, b) => Number(b.workspace.lastUpdated || 0) - Number(a.workspace.lastUpdated || 0))
      .slice(0, RECENT_CHAT_LIMIT);
  }, [projects, scope, user?.uid]);

  const runMobileAction = React.useCallback((action: () => void) => {
    if (mobileOpen) setMobileOpen(false);
    action();
  }, [mobileOpen, setMobileOpen]);

  const selectProject = (id: string) => runMobileAction(() => onSelectProject(id));
  const selectWorkspace = (id: string) => runMobileAction(() => onSelectWorkspace(id));
  const startNewChat = () => runMobileAction(() => onQuickStart?.());
  const openNewProject = () => runMobileAction(() => setShowNewProjectModal(true));
  const canManage = (project: Project) => project.ownerId === user?.uid;

  const openSettings = () => {
    runMobileAction(() => {
      setShowUserMenu(false);
      onOpenSettings();
    });
  };

  const openSearch = () => {
    if (compact) setCollapsed(false);
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 140);
  };

  const compactActionClass = cn(
    'relative flex h-10 w-10 items-center justify-center rounded-xl text-theme-text-muted',
    'transition-colors duration-150 hover:bg-theme-surface-hover hover:text-theme-text',
  );

  const navRowClass = 'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-theme-surface-hover';

  const content = (
    <motion.aside
      initial={false}
      animate={{ width: compact ? 64 : 268 }}
      transition={{ type: 'spring', stiffness: 430, damping: 38 }}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-full max-w-[88vw] shrink-0 flex-col border-r border-theme-border/60 bg-theme-surface shadow-xl md:relative md:z-20 md:shadow-none',
        'transition-transform duration-200',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center', compact ? 'justify-center' : 'justify-between px-3')}>
        <button
          type="button"
          onClick={() => compact ? setCollapsed(false) : undefined}
          className={cn('flex items-center rounded-xl transition-colors hover:bg-theme-surface-hover', compact ? 'p-2' : 'gap-2 px-2 py-1.5')}
          title={compact ? 'Menüyü genişlet' : undefined}
        >
          <SwissLogo compact={compact} />
          {!compact && <span className="text-[15px] font-semibold tracking-tight text-theme-text">JetWork</span>}
        </button>
        {!compact && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="hidden h-9 w-9 items-center justify-center rounded-xl text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text md:flex"
            aria-label="Menüyü daralt"
            title="Menüyü daralt"
          >
            <ChevronLeft size={17} />
          </button>
        )}
      </div>

      {compact ? (
        <div className="flex flex-1 flex-col items-center gap-1 px-2 py-2">
          <button type="button" onClick={startNewChat} className={compactActionClass} title="Yeni sohbet" aria-label="Yeni sohbet">
            <MessageSquarePlus size={19} />
          </button>
          <button type="button" onClick={openSearch} className={compactActionClass} title="Ara" aria-label="Ara">
            <Search size={19} />
          </button>
          <button type="button" onClick={() => setCollapsed(false)} className={compactActionClass} title="Projeler" aria-label="Projeler">
            <Folder size={19} />
          </button>
          {activeWorkspace && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className={cn(compactActionClass, 'mt-3 bg-theme-surface-hover text-theme-text')}
              title={activeWorkspace.title}
              aria-label={`Aktif sohbet: ${activeWorkspace.title}`}
            >
              <FileText size={18} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-theme-primary" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
          <div className="space-y-1 px-1 pb-2">
            <button type="button" onClick={startNewChat} className={cn(navRowClass, 'font-medium text-theme-text')}>
              <MessageSquarePlus size={18} />
              <span>Yeni sohbet</span>
            </button>
            <button type="button" onClick={openSearch} className={cn(navRowClass, 'text-theme-text-muted hover:text-theme-text')}>
              <Search size={18} />
              <span>Ara</span>
            </button>
            {searchOpen && (
              <div className="relative px-2 pb-1 pt-1">
                <Search size={14} className="absolute left-5 top-3.5 text-theme-text-muted" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      setSearchOpen(false);
                      setQuery('');
                    }
                  }}
                  placeholder="Sohbet veya proje ara"
                  className="w-full rounded-xl bg-theme-bg py-2 pl-9 pr-3 text-xs text-theme-text outline-none ring-1 ring-theme-border/60 transition focus:ring-theme-text-muted/40"
                />
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 scrollbar-hide">
            {recentWorkspaces.length > 0 && lifecycle === 'active' && !query && (
              <section className="mb-5">
                <div className="mb-1.5 px-2 text-[11px] font-medium text-theme-text-muted">Son sohbetler</div>
                <div className="space-y-0.5">
                  {recentWorkspaces.map(({ workspace, project }) => (
                    <button
                      type="button"
                      key={`recent-${workspace.id}`}
                      onClick={() => selectWorkspace(workspace.id)}
                      title={`${project.name} · ${workspace.title}`}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors',
                        currentWorkspaceId === workspace.id
                          ? 'bg-theme-surface-hover text-theme-text'
                          : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
                      )}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-45" />
                      <span className="truncate">{workspace.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="relative mb-1 flex items-center justify-between px-2">
                <span className="text-[11px] font-medium text-theme-text-muted">Projeler</span>
                <div className="flex items-center gap-0.5">
                  {scope === 'owned' && lifecycle === 'active' && (
                    <button
                      type="button"
                      onClick={openNewProject}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text"
                      aria-label="Yeni proje"
                      title="Yeni proje"
                    >
                      <Plus size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowFilters(previous => !previous)}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                      showFilters || scope === 'shared' || lifecycle !== 'active'
                        ? 'bg-theme-surface-hover text-theme-text'
                        : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
                    )}
                    aria-label="Proje filtreleri"
                    title="Filtreler"
                  >
                    <SlidersHorizontal size={14} />
                  </button>
                </div>

                {showFilters && (
                  <div className="absolute right-1 top-8 z-30 w-48 rounded-2xl border border-theme-border/70 bg-theme-bg p-2 shadow-xl">
                    <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-theme-text-muted">Kapsam</div>
                    {(['owned', 'shared'] as const).map(value => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setScope(value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-theme-surface-hover',
                          scope === value ? 'font-medium text-theme-text' : 'text-theme-text-muted',
                        )}
                      >
                        {value === 'owned' ? 'Projelerim' : 'Paylaşılanlar'}
                        {scope === value && <span className="h-1.5 w-1.5 rounded-full bg-theme-primary" />}
                      </button>
                    ))}
                    <div className="my-1 border-t border-theme-border/60" />
                    <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-theme-text-muted">Durum</div>
                    {(['active', 'archived', 'trash'] as const).map(value => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setLifecycle(value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-theme-surface-hover',
                          lifecycle === value ? 'font-medium text-theme-text' : 'text-theme-text-muted',
                        )}
                      >
                        {lifecycleLabel[value]}
                        {lifecycle === value && <span className="h-1.5 w-1.5 rounded-full bg-theme-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(scope === 'shared' || lifecycle !== 'active') && (
                <div className="mb-2 flex items-center gap-1.5 px-2 text-[10px] text-theme-text-muted">
                  <span>{scope === 'shared' ? 'Paylaşılanlar' : 'Projelerim'}</span>
                  <span>·</span>
                  <span>{lifecycleLabel[lifecycle]}</span>
                </div>
              )}

              {projectsError && (
                <div className="mx-1 mb-3 rounded-xl bg-red-500/5 p-3 text-xs text-red-600">
                  <p>Projeler yüklenemedi.</p>
                  <button type="button" onClick={onRetryProjects} className="mt-2 flex items-center gap-1 font-medium">
                    <RefreshCw size={12} /> Tekrar dene
                  </button>
                </div>
              )}

              {isLoadingProjects && projects.length === 0 && (
                <Loader2 className="mx-auto mt-6 animate-spin text-theme-text-muted" size={18} />
              )}

              <div className="space-y-0.5">
                {filtered.slice(0, visibleCount).map(project => {
                  const isProjectActive = currentProjectId === project.id || activeProject?.id === project.id;
                  const open = Boolean(expanded[project.id]);
                  return (
                    <div key={project.id} className={cn('group/project rounded-xl', isProjectActive && 'bg-theme-surface-hover/60')}>
                      <div className="flex min-w-0 items-center gap-0.5 pr-1">
                        <button
                          type="button"
                          onClick={() => setExpanded(state => ({ ...state, [project.id]: !state[project.id] }))}
                          className="flex h-8 w-7 shrink-0 items-center justify-center text-theme-text-muted"
                          aria-label={`${project.name} sohbetlerini ${open ? 'daralt' : 'genişlet'}`}
                        >
                          <ChevronRight size={13} className={cn('transition-transform duration-150', open && 'rotate-90')} />
                        </button>
                        <button
                          type="button"
                          onClick={() => selectProject(project.id)}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm transition-colors',
                            isProjectActive ? 'font-medium text-theme-text' : 'text-theme-text-muted hover:text-theme-text',
                          )}
                        >
                          <Folder size={15} className="shrink-0 opacity-70" />
                          <span className="truncate">{project.name}</span>
                        </button>
                        {canManage(project) && (
                          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100">
                            {lifecycle === 'active' && (
                              <button type="button" onClick={() => onArchiveProject?.(project.id)} className="p-1.5 text-theme-text-muted hover:text-theme-text" title="Arşivle">
                                <Archive size={12} />
                              </button>
                            )}
                            {lifecycle !== 'active' && (
                              <button type="button" onClick={() => onRestoreProject?.(project.id)} className="p-1.5 text-theme-text-muted hover:text-theme-text" title="Geri yükle">
                                <RotateCcw size={12} />
                              </button>
                            )}
                            {lifecycle !== 'trash' && (
                              <button type="button" onClick={() => onDeleteProject?.(project.id)} className="p-1.5 text-theme-text-muted hover:text-red-500" title="Çöp kutusuna taşı">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {open && (
                        <div className="mb-1 ml-7 space-y-0.5 pl-2">
                          {project.workspaces
                            .filter(workspace => !workspace.deletedAt && !workspace.archivedAt)
                            .map(workspace => (
                              <button
                                type="button"
                                key={workspace.id}
                                onClick={() => selectWorkspace(workspace.id)}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                                  currentWorkspaceId === workspace.id
                                    ? 'bg-theme-bg font-medium text-theme-text'
                                    : 'text-theme-text-muted hover:bg-theme-bg/70 hover:text-theme-text',
                                )}
                              >
                                <FileText size={12} className="shrink-0 opacity-65" />
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
                <div className="px-3 py-8 text-center text-xs text-theme-text-muted">
                  {query ? 'Aramana uygun sonuç yok.' : 'Bu görünümde henüz proje yok.'}
                </div>
              )}

              {filtered.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text"
                >
                  <ChevronDown size={14} /> Daha fazla
                </button>
              )}
            </section>
          </div>
        </div>
      )}

      <div className={cn('relative shrink-0 border-t border-theme-border/50', compact ? 'flex justify-center p-2' : 'p-2')}>
        <button
          type="button"
          onClick={() => {
            if (compact) setCollapsed(false);
            else setShowUserMenu(previous => !previous);
          }}
          className={cn(
            'flex items-center rounded-xl text-theme-text transition-colors hover:bg-theme-surface-hover',
            compact ? 'justify-center p-2' : 'w-full gap-2.5 px-2.5 py-2',
          )}
          title={compact ? `${user?.name || 'Profil'} — menüyü aç` : undefined}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-theme-text text-xs font-semibold text-theme-bg">
            {user?.name?.charAt(0)?.toLocaleUpperCase('tr-TR') || 'U'}
          </div>
          {!compact && (
            <>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-medium">{user?.name}</p>
                <p className="truncate text-[10px] text-theme-text-muted">{user?.role}</p>
              </div>
              <MoreHorizontal size={16} className="text-theme-text-muted" />
            </>
          )}
        </button>

        {showUserMenu && !compact && (
          <div className="absolute bottom-full left-2 right-2 mb-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-theme-border/70 bg-theme-bg p-2 shadow-xl">
            <button type="button" onClick={openSettings} className="flex w-full items-center gap-2 rounded-xl p-2 text-xs text-theme-text hover:bg-theme-surface-hover">
              <User size={14} /> Profil ve ayarlar
            </button>

            <div className="my-1 border-t border-theme-border/60 pt-2">
              <label htmlFor="sidebar-ai-model" className="mb-1 block px-2 text-[10px] font-medium text-theme-text-muted">Model</label>
              <select
                id="sidebar-ai-model"
                value={selectedModel}
                onChange={event => setSelectedModel(event.target.value)}
                className="w-full rounded-xl bg-theme-surface px-2.5 py-2 text-xs text-theme-text outline-none"
              >
                <option value="auto">Otomatik · OpenAI + Gemini</option>
                <option value="gpt-5.6-sol">OpenAI · GPT-5.6 Sol</option>
                <option value="gpt-5.6">OpenAI · GPT-5.6</option>
                <option value="gemini-3-flash-preview">Gemini · 3 Flash</option>
                <option value="gemini-3.1-pro-preview">Gemini · 3.1 Pro</option>
                <option value="gemini-3.1-flash-lite-preview">Gemini · 3.1 Flash Lite</option>
              </select>
            </div>

            <div className="my-1 border-t border-theme-border/60 pt-2">
              <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium text-theme-text-muted">
                <Settings2 size={11} /> Görünüm
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['monochrome', 'energetic', 'ocean'] as const).map(themeName => (
                  <button
                    type="button"
                    key={themeName}
                    onClick={() => onThemeChange(themeName)}
                    className={cn(
                      'rounded-lg px-1 py-1.5 text-[9px] transition-colors',
                      theme === themeName ? 'bg-theme-surface-hover font-medium text-theme-text' : 'text-theme-text-muted hover:bg-theme-surface-hover',
                    )}
                  >
                    {themeName}
                  </button>
                ))}
              </div>
            </div>

            <div className="my-1 border-t border-theme-border/60" />
            <button type="button" onClick={onLogout} className="flex w-full items-center gap-2 rounded-xl p-2 text-xs text-red-500 hover:bg-red-500/10">
              <LogOut size={14} /> Çıkış yap
            </button>
          </div>
        )}
      </div>
    </motion.aside>
  );

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Menüyü kapat"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] md:hidden"
        />
      )}
      {content}
    </>
  );
}
