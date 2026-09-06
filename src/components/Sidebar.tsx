import React from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderInput,
  Loader2,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
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
import { toast } from 'sonner';
import { Project, Workspace } from '../types';
import { cn } from '../lib/utils';
import { nowIso } from '../lib/mapping';
import { supabase } from '../supabase';
import { useDataStore } from '../store/useDataStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { STANDALONE_PROJECT_ID } from '../hooks/useProjects';
import { setWorkspaceProject } from '../services/workspaceScopeRepository';
import { JetWorkLogo } from './JetWorkLogo';

export type ThemeType = 'monochrome' | 'energetic' | 'ocean';
type Lifecycle = 'active' | 'archived' | 'trash';
type ConversationRowSize = 'default' | 'compact';

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

interface AnchorBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ChatMenuState {
  workspace: Workspace;
  projectId: string | null;
  anchor: AnchorBox;
}

interface ConversationRowProps {
  workspace: Workspace;
  projectId: string | null;
  currentWorkspaceId: string | null;
  canManage: boolean;
  menuOpen: boolean;
  size?: ConversationRowSize;
  title?: string;
  onSelect: () => void;
  onOpenMenu: (button: HTMLButtonElement) => void;
}

interface ConversationActionsMenuProps {
  menu: ChatMenuState;
  projects: Project[];
  lifecycle: Lifecycle;
  pending: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onRename: () => void;
  onMove: (projectId: string | null) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

const PAGE_SIZE = 30;
const RECENT_CHAT_LIMIT = 7;
const SIDEBAR_COLLAPSED_KEY = 'jetwork:global-sidebar:collapsed';
const CHAT_MENU_WIDTH = 224;

const readCollapsedPreference = (): boolean => {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};

const lifecycleLabel: Record<Lifecycle, string> = {
  active: 'Aktif',
  archived: 'Arşiv',
  trash: 'Çöp',
};

const conversationSectionLabel: Record<Lifecycle, string> = {
  active: 'Sohbetler',
  archived: 'Arşivlenen sohbetler',
  trash: 'Çöp kutusundaki sohbetler',
};

function ConversationRow({
  workspace,
  projectId,
  currentWorkspaceId,
  canManage,
  menuOpen,
  size = 'default',
  title,
  onSelect,
  onOpenMenu,
}: ConversationRowProps) {
  const compact = size === 'compact';
  const selected = currentWorkspaceId === workspace.id;

  return (
    <div
      className={cn(
        'group/chat relative flex min-w-0 items-center rounded-xl',
        (selected || menuOpen) && 'bg-theme-surface-hover',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        title={title || workspace.title}
        className={cn(
          'min-w-0 flex-1 truncate text-left transition-colors',
          compact ? 'rounded-lg px-2 py-1.5 pr-10 text-xs' : 'rounded-xl px-2.5 py-2 pr-11 text-sm',
          selected || menuOpen
            ? 'font-medium text-theme-text'
            : compact
              ? 'text-theme-text-muted hover:bg-theme-bg/70 hover:text-theme-text'
              : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
        )}
      >
        {workspace.title}
      </button>

      {canManage && (
        <button
          type="button"
          data-chat-menu-trigger={workspace.id}
          data-project-id={projectId || ''}
          onClick={event => {
            event.stopPropagation();
            onOpenMenu(event.currentTarget);
          }}
          className={cn(
            'absolute right-0.5 flex h-9 w-9 items-center justify-center rounded-lg text-theme-text-muted transition-all hover:bg-theme-bg hover:text-theme-text focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary/40',
            menuOpen
              ? 'opacity-100'
              : 'opacity-60 md:opacity-0 md:group-hover/chat:opacity-100',
          )}
          title="Sohbet seçenekleri"
          aria-label={`${workspace.title} seçenekleri`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={15} />
        </button>
      )}
    </div>
  );
}

function ConversationActionsMenu({
  menu,
  projects,
  lifecycle,
  pending,
  menuRef,
  onClose,
  onRename,
  onMove,
  onArchive,
  onRestore,
  onDelete,
}: ConversationActionsMenuProps) {
  const [view, setView] = React.useState<'root' | 'move'>('root');
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const openToRight = menu.anchor.right + 8 + CHAT_MENU_WIDTH <= viewportWidth - 8;
  const left = openToRight
    ? menu.anchor.right + 8
    : Math.max(8, menu.anchor.left - CHAT_MENU_WIDTH - 8);
  const top = Math.min(menu.anchor.bottom + 4, Math.max(8, viewportHeight - 320));
  const moveTargets = projects.filter(project => (
    !project.deletedAt && !project.archivedAt && project.id !== menu.projectId
  ));

  const actionClass = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-theme-surface-hover disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${menu.workspace.title} sohbet seçenekleri`}
      className="fixed z-[100] w-56 rounded-xl border border-theme-border/70 bg-theme-bg p-1.5 shadow-2xl"
      style={{ left, top, maxHeight: 'min(420px, calc(100vh - 16px))' }}
    >
      {view === 'move' ? (
        <div className="max-h-[min(380px,60vh)] overflow-y-auto">
          <button
            type="button"
            onClick={() => setView('root')}
            className={cn(actionClass, 'mb-1 font-medium text-theme-text')}
            disabled={pending}
          >
            <ChevronLeft size={14} />
            Projeye taşı
          </button>
          <div className="mb-1 border-t border-theme-border/60" />

          {menu.projectId && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onMove(null)}
              className={cn(actionClass, 'text-theme-text-muted hover:text-theme-text')}
              disabled={pending}
            >
              <MessageSquarePlus size={14} />
              Bağımsız sohbete taşı
            </button>
          )}

          {moveTargets.map(project => (
            <button
              type="button"
              role="menuitem"
              key={project.id}
              onClick={() => onMove(project.id)}
              className={cn(actionClass, 'text-theme-text-muted hover:text-theme-text')}
              disabled={pending}
            >
              <Folder size={14} className="shrink-0" />
              <span className="truncate">{project.name}</span>
            </button>
          ))}

          {!menu.projectId && moveTargets.length === 0 && (
            <div className="px-2.5 py-3 text-xs text-theme-text-muted">Taşınabilecek aktif proje yok.</div>
          )}
        </div>
      ) : (
        <>
          {lifecycle === 'active' ? (
            <>
              <button type="button" role="menuitem" onClick={onRename} className={cn(actionClass, 'text-theme-text')} disabled={pending}>
                <Pencil size={14} />
                Yeniden adlandır
              </button>
              <button type="button" role="menuitem" onClick={() => setView('move')} className={cn(actionClass, 'text-theme-text')} disabled={pending}>
                <FolderInput size={14} />
                Projeye taşı
                <ChevronRight size={13} className="ml-auto" />
              </button>
              <button type="button" role="menuitem" onClick={onArchive} className={cn(actionClass, 'text-theme-text')} disabled={pending}>
                <Archive size={14} />
                Arşivle
              </button>
              <div className="my-1 border-t border-theme-border/60" />
              <button type="button" role="menuitem" onClick={onDelete} className={cn(actionClass, 'text-red-500 hover:bg-red-500/10')} disabled={pending}>
                <Trash2 size={14} />
                Sil
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={onRestore} className={cn(actionClass, 'text-theme-text')} disabled={pending}>
                <RotateCcw size={14} />
                Geri yükle
              </button>
              {lifecycle !== 'trash' && (
                <>
                  <div className="my-1 border-t border-theme-border/60" />
                  <button type="button" role="menuitem" onClick={onDelete} className={cn(actionClass, 'text-red-500 hover:bg-red-500/10')} disabled={pending}>
                    <Trash2 size={14} />
                    Sil
                  </button>
                </>
              )}
            </>
          )}

          {pending && (
            <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-theme-text-muted">
              <Loader2 size={12} className="animate-spin" />
              İşleniyor…
            </div>
          )}
        </>
      )}

      <button type="button" className="sr-only" onClick={onClose}>Menüyü kapat</button>
    </div>
  );
}

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
  const setCurrentWorkspaceId = useDataStore(state => state.setCurrentWorkspaceId);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const setEditingWorkspace = useUIStore(state => state.setEditingWorkspace);
  const setDeletingWorkspace = useUIStore(state => state.setDeletingWorkspace);
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
  const [chatMenu, setChatMenu] = React.useState<ChatMenuState | null>(null);
  const [pendingChatId, setPendingChatId] = React.useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const chatMenuRef = React.useRef<HTMLDivElement>(null);

  const standaloneGroup = React.useMemo(
    () => projects.find(project => project.id === STANDALONE_PROJECT_ID),
    [projects],
  );
  const standaloneWorkspaces = standaloneGroup?.workspaces || [];
  const actualProjects = React.useMemo(
    () => projects.filter(project => project.id !== STANDALONE_PROJECT_ID),
    [projects],
  );

  const compact = collapsed && !mobileOpen;
  const activeProject = React.useMemo(
    () => actualProjects.find(project => project.workspaces.some(workspace => workspace.id === currentWorkspaceId)),
    [actualProjects, currentWorkspaceId],
  );
  const activeWorkspace = React.useMemo(
    () => standaloneWorkspaces.find(workspace => workspace.id === currentWorkspaceId)
      || activeProject?.workspaces.find(workspace => workspace.id === currentWorkspaceId),
    [activeProject, currentWorkspaceId, standaloneWorkspaces],
  );

  const workspaceMatchesLifecycle = React.useCallback((workspace: Workspace) => {
    if (lifecycle === 'trash') return Boolean(workspace.deletedAt);
    if (workspace.deletedAt) return false;
    if (lifecycle === 'archived') return Boolean(workspace.archivedAt);
    return !workspace.archivedAt;
  }, [lifecycle]);

  const projectMatchesLifecycle = React.useCallback((project: Project) => {
    if (lifecycle === 'trash') return Boolean(project.deletedAt);
    if (project.deletedAt) return false;
    if (lifecycle === 'archived') return Boolean(project.archivedAt);
    return !project.archivedAt;
  }, [lifecycle]);

  const projectMatchesScope = React.useCallback((project: Project) => {
    const owned = project.ownerId === user?.uid;
    return (scope === 'owned') === owned;
  }, [scope, user?.uid]);

  const getVisibleProjectWorkspaces = React.useCallback((project: Project) => {
    if (lifecycle === 'active') {
      return project.workspaces.filter(workspace => !workspace.deletedAt && !workspace.archivedAt);
    }
    if (lifecycle === 'archived') {
      if (project.archivedAt && !project.deletedAt) {
        return project.workspaces.filter(workspace => !workspace.deletedAt);
      }
      return project.workspaces.filter(workspace => !workspace.deletedAt && Boolean(workspace.archivedAt));
    }
    if (project.deletedAt) return project.workspaces;
    return project.workspaces.filter(workspace => Boolean(workspace.deletedAt));
  }, [lifecycle]);

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

  React.useEffect(() => {
    if (!chatMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (chatMenuRef.current?.contains(target)) return;
      const trigger = target.closest('[data-chat-menu-trigger]');
      if (trigger?.getAttribute('data-chat-menu-trigger') === chatMenu.workspace.id) return;
      setChatMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChatMenu(null);
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [chatMenu]);

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return actualProjects.filter(project => {
      if (!projectMatchesScope(project)) return false;

      const projectLifecycleMatch = projectMatchesLifecycle(project);
      const matchingWorkspaces = getVisibleProjectWorkspaces(project);
      if (lifecycle === 'active') {
        if (!projectLifecycleMatch) return false;
      } else if (!projectLifecycleMatch && matchingWorkspaces.length === 0) {
        return false;
      }

      if (!normalized) return true;
      return [project.name, project.description, ...matchingWorkspaces.map(workspace => workspace.title)]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(normalized);
    });
  }, [actualProjects, getVisibleProjectWorkspaces, lifecycle, projectMatchesLifecycle, projectMatchesScope, query]);

  const visibleStandalone = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return standaloneWorkspaces
      .filter(workspaceMatchesLifecycle)
      .filter(workspace => !normalized || workspace.title.toLocaleLowerCase('tr-TR').includes(normalized))
      .sort((a, b) => Number(b.lastUpdated || 0) - Number(a.lastUpdated || 0));
  }, [query, standaloneWorkspaces, workspaceMatchesLifecycle]);

  const recentWorkspaces = React.useMemo(() => {
    if (lifecycle !== 'active') return [];
    const rows: Array<{ workspace: Workspace; project: Project }> = [];
    actualProjects.forEach(project => {
      if (!projectMatchesScope(project) || project.deletedAt || project.archivedAt) return;
      project.workspaces.forEach(workspace => {
        if (!workspace.deletedAt && !workspace.archivedAt) rows.push({ workspace, project });
      });
    });
    return rows
      .sort((a, b) => Number(b.workspace.lastUpdated || 0) - Number(a.workspace.lastUpdated || 0))
      .slice(0, RECENT_CHAT_LIMIT);
  }, [actualProjects, lifecycle, projectMatchesScope]);

  const runMobileAction = React.useCallback((action: () => void) => {
    if (mobileOpen) setMobileOpen(false);
    action();
  }, [mobileOpen, setMobileOpen]);

  const closeChatMenu = React.useCallback(() => setChatMenu(null), []);

  const selectProject = (id: string) => {
    closeChatMenu();
    runMobileAction(() => onSelectProject(id));
  };

  const selectWorkspace = (id: string) => {
    closeChatMenu();
    runMobileAction(() => onSelectWorkspace(id));
  };

  const startNewChat = () => {
    closeChatMenu();
    runMobileAction(() => onQuickStart?.());
  };

  const openNewProject = () => runMobileAction(() => setShowNewProjectModal(true));
  const canManageProject = (project: Project) => project.ownerId === user?.uid;
  const canManageWorkspace = (workspace: Workspace) => workspace.ownerId === user?.uid;

  const toggleChatMenu = (workspace: Workspace, projectId: string | null, button: HTMLButtonElement) => {
    setShowFilters(false);
    setShowUserMenu(false);
    setChatMenu(current => {
      if (current?.workspace.id === workspace.id) return null;
      const rect = button.getBoundingClientRect();
      return {
        workspace,
        projectId,
        anchor: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      };
    });
  };

  const updateWorkspaceLifecycle = async (
    workspaceId: string,
    values: { archived_at?: string | null; deleted_at?: string | null },
  ) => {
    const { error } = await supabase
      .from('workspaces')
      .update({ ...values, last_updated: nowIso() })
      .eq('id', workspaceId)
      .select('id')
      .single();
    if (error) throw error;
  };

  const archiveWorkspace = async (workspace: Workspace) => {
    setPendingChatId(workspace.id);
    try {
      await updateWorkspaceLifecycle(workspace.id, { archived_at: nowIso(), deleted_at: null });
      if (currentWorkspaceId === workspace.id) setCurrentWorkspaceId(null);
      setChatMenu(null);
      toast.success('Sohbet arşivlendi.');
    } catch (error) {
      console.error('Failed to archive conversation:', error);
      toast.error('Sohbet arşivlenemedi.');
    } finally {
      setPendingChatId(null);
    }
  };

  const restoreWorkspace = async (workspace: Workspace) => {
    setPendingChatId(workspace.id);
    try {
      await updateWorkspaceLifecycle(workspace.id, { archived_at: null, deleted_at: null });
      setChatMenu(null);
      toast.success('Sohbet geri yüklendi.');
    } catch (error) {
      console.error('Failed to restore conversation:', error);
      toast.error('Sohbet geri yüklenemedi.');
    } finally {
      setPendingChatId(null);
    }
  };

  const moveWorkspace = async (workspace: Workspace, projectId: string | null) => {
    setPendingChatId(workspace.id);
    try {
      await setWorkspaceProject(workspace.id, projectId);
      setChatMenu(null);
      toast.success(projectId ? 'Sohbet projeye taşındı.' : 'Sohbet bağımsız sohbetlere taşındı.');
    } catch (error) {
      console.error('Failed to move conversation:', error);
      toast.error('Sohbet taşınamadı.');
    } finally {
      setPendingChatId(null);
    }
  };

  const renameWorkspace = (workspace: Workspace) => {
    setChatMenu(null);
    if (mobileOpen) setMobileOpen(false);
    setEditingWorkspace(workspace);
  };

  const deleteWorkspace = (workspaceId: string) => {
    setChatMenu(null);
    if (mobileOpen) setMobileOpen(false);
    setDeletingWorkspace(workspaceId);
  };

  const openSettings = () => {
    runMobileAction(() => {
      setShowUserMenu(false);
      onOpenSettings();
    });
  };

  const openSearch = () => {
    closeChatMenu();
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
          <JetWorkLogo className={compact ? 'h-[26px] w-[26px]' : 'h-7 w-7'} />
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
            {searchOpen ? (
              <div className="relative flex w-full items-center rounded-xl bg-theme-bg ring-1 ring-theme-border/60 transition focus-within:ring-theme-text-muted/40">
                <Search size={18} className="pointer-events-none absolute left-3 text-theme-text-muted" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  onBlur={() => {
                    if (!query.trim()) setSearchOpen(false);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      setSearchOpen(false);
                      setQuery('');
                    }
                  }}
                  aria-label="Sohbet veya proje ara"
                  placeholder="Sohbet veya proje ara"
                  className="w-full rounded-xl bg-transparent py-2 pl-10 pr-3 text-sm text-theme-text outline-none placeholder:text-theme-text-muted"
                />
              </div>
            ) : (
              <button type="button" onClick={openSearch} className={cn(navRowClass, 'text-theme-text-muted hover:text-theme-text')}>
                <Search size={18} />
                <span>Ara</span>
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 scrollbar-hide">
            <section className="mb-5">
              <div className="mb-1.5 px-2 text-[11px] font-medium text-theme-text-muted">{conversationSectionLabel[lifecycle]}</div>
              <div className="space-y-0.5">
                {visibleStandalone.map(workspace => (
                  <ConversationRow
                    key={workspace.id}
                    workspace={workspace}
                    projectId={null}
                    currentWorkspaceId={currentWorkspaceId}
                    canManage={canManageWorkspace(workspace)}
                    menuOpen={chatMenu?.workspace.id === workspace.id}
                    onSelect={() => selectWorkspace(workspace.id)}
                    onOpenMenu={button => toggleChatMenu(workspace, null, button)}
                  />
                ))}
                {visibleStandalone.length === 0 && (
                  <div className="px-3 py-2 text-xs text-theme-text-muted">
                    {query ? 'Aramana uygun bağımsız sohbet yok.' : `Bu görünümde bağımsız sohbet yok.`}
                  </div>
                )}
              </div>
            </section>

            {recentWorkspaces.length > 0 && !query && (
              <section className="mb-5">
                <div className="mb-1.5 px-2 text-[11px] font-medium text-theme-text-muted">Son kullanılanlar</div>
                <div className="space-y-0.5">
                  {recentWorkspaces.map(({ workspace, project }) => (
                    <ConversationRow
                      key={`recent-${workspace.id}`}
                      workspace={workspace}
                      projectId={project.id}
                      currentWorkspaceId={currentWorkspaceId}
                      canManage={canManageWorkspace(workspace)}
                      menuOpen={chatMenu?.workspace.id === workspace.id}
                      title={`${project.name} · ${workspace.title}`}
                      onSelect={() => selectWorkspace(workspace.id)}
                      onOpenMenu={button => toggleChatMenu(workspace, project.id, button)}
                    />
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
                    onClick={() => {
                      closeChatMenu();
                      setShowFilters(previous => !previous);
                    }}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                      showFilters || scope === 'shared' || lifecycle !== 'active'
                        ? 'bg-theme-surface-hover text-theme-text'
                        : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
                    )}
                    aria-label="Sohbet ve proje filtreleri"
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
                  const projectLifecycleMatch = projectMatchesLifecycle(project);
                  const visibleWorkspaces = getVisibleProjectWorkspaces(project);

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
                        {canManageProject(project) && projectLifecycleMatch && (
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
                          {visibleWorkspaces.map(workspace => (
                            <ConversationRow
                              key={workspace.id}
                              workspace={workspace}
                              projectId={project.id}
                              currentWorkspaceId={currentWorkspaceId}
                              canManage={canManageWorkspace(workspace)}
                              menuOpen={chatMenu?.workspace.id === workspace.id}
                              size="compact"
                              onSelect={() => selectWorkspace(workspace.id)}
                              onOpenMenu={button => toggleChatMenu(workspace, project.id, button)}
                            />
                          ))}
                          {visibleWorkspaces.length === 0 && (
                            <div className="px-2 py-1.5 text-[11px] text-theme-text-muted">Bu görünümde sohbet yok.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {filtered.length === 0 && !isLoadingProjects && (
                <div className="px-3 py-8 text-center text-xs text-theme-text-muted">
                  {query ? 'Aramana uygun sonuç yok.' : 'Bu görünümde henüz proje veya proje sohbeti yok.'}
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
            closeChatMenu();
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
                <option value="gemini-3.8-flash">Gemini · 3.8 Flash</option>
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
      {chatMenu && typeof document !== 'undefined' && createPortal(
        <ConversationActionsMenu
          key={`${chatMenu.workspace.id}-${chatMenu.projectId || 'standalone'}-${lifecycle}`}
          menu={chatMenu}
          projects={actualProjects}
          lifecycle={lifecycle}
          pending={pendingChatId === chatMenu.workspace.id}
          menuRef={chatMenuRef}
          onClose={closeChatMenu}
          onRename={() => renameWorkspace(chatMenu.workspace)}
          onMove={projectId => void moveWorkspace(chatMenu.workspace, projectId)}
          onArchive={() => void archiveWorkspace(chatMenu.workspace)}
          onRestore={() => void restoreWorkspace(chatMenu.workspace)}
          onDelete={() => deleteWorkspace(chatMenu.workspace.id)}
        />,
        document.body,
      )}
    </>
  );
}