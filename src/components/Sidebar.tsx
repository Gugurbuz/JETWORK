import React from 'react';
import {
  Archive, ChevronDown, ChevronLeft, ChevronRight, FileText, FolderPlus,
  Loader2, LogOut, Plus, RefreshCw, RotateCcw, Search, Settings, Trash2, User,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Project } from '../types';
import { cn } from '../lib/utils';
import { useDataStore } from '../store/useDataStore';
import { useUIStore } from '../store/useUIStore';

export type ThemeType = 'monochrome' | 'energetic' | 'ocean';
type Lifecycle = 'active' | 'archived' | 'trash';

interface SidebarProps {
  user: { uid: string; name: string; role: string; color?: string } | null;
  onSelectWorkspace: (id: string) => void;
  onSelectProject: (id: string) => void;
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

export function Sidebar(props: SidebarProps) {
  const { user, onSelectWorkspace, onSelectProject, onEditProject, onDeleteProject,
    onArchiveProject, onRestoreProject, isLoadingProjects, projectsError,
    onRetryProjects, theme, onThemeChange, onLogout, onOpenSettings } = props;
  const [collapsed, setCollapsed] = React.useState(false);
  const [scope, setScope] = React.useState<'owned' | 'shared'>('owned');
  const [lifecycle, setLifecycle] = React.useState<Lifecycle>('active');
  const [query, setQuery] = React.useState('');
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const projects = useDataStore(state => state.projects);
  const currentProjectId = useDataStore(state => state.currentProjectId);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const mobileOpen = useUIStore(state => state.mobileSidebarOpen);
  const setMobileOpen = useUIStore(state => state.setMobileSidebarOpen);

  React.useEffect(() => setVisibleCount(PAGE_SIZE), [scope, lifecycle, query]);

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return projects.filter(project => {
      const owned = project.ownerId === user?.uid;
      if ((scope === 'owned') !== owned) return false;
      if (lifecycle === 'trash' ? !project.deletedAt : project.deletedAt) return false;
      if (lifecycle === 'archived' ? !project.archivedAt : lifecycle === 'active' && project.archivedAt) return false;
      if (!normalized) return true;
      return [project.name, project.description, ...project.workspaces.map(w => w.title)]
        .filter(Boolean).join(' ').toLocaleLowerCase('tr-TR').includes(normalized);
    });
  }, [projects, query, scope, lifecycle, user?.uid]);

  const selectProject = (id: string) => { onSelectProject(id); setMobileOpen(false); };
  const selectWorkspace = (id: string) => { onSelectWorkspace(id); setMobileOpen(false); };
  const canManage = (project: Project) => project.ownerId === user?.uid;

  const content = (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 280 }}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col border-r border-theme-border bg-theme-bg shadow-xl transition-transform md:relative md:z-20 md:shadow-none',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}
    >
      <button type="button" onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border border-theme-border bg-theme-surface md:flex"
        aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}>
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
      <div className="flex h-16 items-center gap-3 border-b border-theme-border px-5">
        <div className="grid h-8 w-8 shrink-0 place-items-center bg-amber-400 font-black text-zinc-900">J</div>
        {!collapsed && <span className="font-bold text-theme-text">JetWork</span>}
      </div>

      {!collapsed && <div className="space-y-3 border-b border-theme-border p-4">
        <div className="grid grid-cols-2 rounded-lg border border-theme-border bg-theme-surface p-1 text-xs">
          {(['owned', 'shared'] as const).map(value => <button key={value} type="button" onClick={() => setScope(value)}
            className={cn('rounded-md py-1.5', scope === value && 'bg-theme-surface-hover font-semibold')}>
            {value === 'owned' ? 'Projelerim' : 'Paylaşılanlar'}
          </button>)}
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          {([['active', 'Aktif'], ['archived', 'Arşiv'], ['trash', 'Çöp']] as const).map(([value, label]) =>
            <button key={value} type="button" onClick={() => setLifecycle(value)}
              className={cn('rounded-md border border-theme-border px-1 py-1.5', lifecycle === value && 'border-theme-primary text-theme-primary')}>{label}</button>)}
        </div>
        <div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-theme-text-muted" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Proje veya sohbet ara"
            className="w-full rounded-md border border-theme-border bg-theme-surface py-2 pl-9 pr-3 text-xs outline-none" />
        </div>
      </div>}

      <div className="flex-1 overflow-y-auto p-3">
        {!collapsed && <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-bold text-theme-text-muted">
          <span>{lifecycle === 'active' ? 'PROJELER' : lifecycle === 'archived' ? 'ARŞİV' : 'ÇÖP KUTUSU'}</span>
          {scope === 'owned' && lifecycle === 'active' && <button type="button" onClick={() => setShowNewProjectModal(true)} aria-label="Yeni proje"><Plus size={15} /></button>}
        </div>}
        {projectsError && !collapsed && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
          <p>Projeler yüklenemedi.</p><button type="button" onClick={onRetryProjects} className="mt-2 flex items-center gap-1 font-semibold"><RefreshCw size={12} />Tekrar dene</button>
        </div>}
        {isLoadingProjects && projects.length === 0 && <Loader2 className="mx-auto mt-6 animate-spin text-theme-text-muted" size={18} />}
        <div className="space-y-1">
          {filtered.slice(0, visibleCount).map(project => <div key={project.id} className="group relative rounded-lg hover:bg-theme-surface">
            <div className="flex items-center gap-1 p-1.5">
              <button type="button" onClick={() => setExpanded(s => ({ ...s, [project.id]: !s[project.id] }))} className="p-1">
                <ChevronRight size={14} className={cn('transition-transform', expanded[project.id] && 'rotate-90')} />
              </button>
              <button type="button" onClick={() => selectProject(project.id)} className={cn('flex min-w-0 flex-1 items-center gap-2 text-left', currentProjectId === project.id && 'text-theme-primary')}>
                <FolderPlus size={16} className="shrink-0" /><span className="truncate text-sm font-medium">{project.name}</span>
              </button>
              {canManage(project) && <div className="flex items-center">
                {lifecycle === 'active' && <button type="button" onClick={() => onArchiveProject?.(project.id)} className="p-1.5" title="Arşivle"><Archive size={12} /></button>}
                {lifecycle !== 'active' && <button type="button" onClick={() => onRestoreProject?.(project.id)} className="p-1.5 text-emerald-600" title="Geri yükle"><RotateCcw size={12} /></button>}
                {lifecycle !== 'trash' && <button type="button" onClick={() => onDeleteProject?.(project.id)} className="p-1.5 text-red-500" title="Çöp kutusuna taşı"><Trash2 size={12} /></button>}
              </div>}
            </div>
            {expanded[project.id] && <div className="mb-2 ml-8 border-l border-theme-border pl-2">
              {project.workspaces.filter(w => !w.deletedAt && !w.archivedAt).map(ws => <button type="button" key={ws.id} onClick={() => selectWorkspace(ws.id)}
                className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-theme-text-muted hover:bg-theme-surface-hover', currentWorkspaceId === ws.id && 'text-theme-primary')}>
                <FileText size={12} /><span className="truncate">{ws.title}</span>
              </button>)}
            </div>}
          </div>)}
        </div>
        {!collapsed && filtered.length === 0 && !isLoadingProjects && <div className="mt-4 rounded-lg border border-dashed border-theme-border p-4 text-center text-xs text-theme-text-muted">Bu görünümde proje yok.</div>}
        {!collapsed && filtered.length > visibleCount && <button type="button" onClick={() => setVisibleCount(c => c + PAGE_SIZE)} className="mt-3 flex w-full items-center justify-center gap-1 rounded-md border border-theme-border py-2 text-xs font-semibold"><ChevronDown size={14} />Daha fazla ({filtered.length - visibleCount})</button>}
      </div>

      <div className="relative border-t border-theme-border p-4">
        <button type="button" onClick={() => setShowUserMenu(!showUserMenu)} className="flex w-full items-center gap-3 rounded-lg p-2 hover:bg-theme-surface">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-theme-primary text-xs font-bold text-theme-primary-fg">{user?.name?.charAt(0) || 'U'}</div>
          {!collapsed && <><div className="min-w-0 flex-1 text-left"><p className="truncate text-xs font-bold">{user?.name}</p><p className="truncate text-[10px] text-theme-text-muted">{user?.role}</p></div><Settings size={14} /></>}
        </button>
        {showUserMenu && !collapsed && <div className="absolute bottom-full left-4 right-4 mb-2 rounded-lg border border-theme-border bg-theme-surface p-1 shadow-xl">
          <button type="button" onClick={onOpenSettings} className="flex w-full items-center gap-2 rounded p-2 text-xs hover:bg-theme-surface-hover"><User size={14} />Profil ve ayarlar</button>
          <div className="grid grid-cols-3 gap-1 p-1">{(['monochrome', 'energetic', 'ocean'] as const).map(t => <button type="button" key={t} onClick={() => onThemeChange(t)} className={cn('rounded border p-1 text-[9px]', theme === t ? 'border-theme-primary' : 'border-theme-border')}>{t}</button>)}</div>
          <button type="button" onClick={onLogout} className="flex w-full items-center gap-2 rounded p-2 text-xs text-red-500 hover:bg-red-500/10"><LogOut size={14} />Çıkış yap</button>
        </div>}
      </div>
    </motion.aside>
  );

  return <>{mobileOpen && <button type="button" aria-label="Menüyü kapat" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/50 md:hidden" />}{content}</>;
}
