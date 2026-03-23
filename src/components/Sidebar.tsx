import React from 'react';
import { Plus, MessageSquare, LayoutDashboard, Settings, BrainCircuit, History, ChevronLeft, ChevronRight, ChevronDown, Palette, FolderPlus, LogOut, User, Search, Monitor, Smartphone, Edit2, Trash2, FileText } from 'lucide-react';
import { Project, Workspace } from '../types';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../store/useStore';

export type ThemeType = 'monochrome' | 'energetic' | 'ocean';

interface SidebarProps {
  user: { name: string; role: string } | null;
  onSelectWorkspace: (id: string) => void;
  onSelectProject: (id: string) => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (id: string) => void;
  theme: ThemeType;
  onThemeChange: (theme: ThemeType) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
}

// Minimalist Swiss Logo
const SwissLogo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-theme-text">
    <rect width="32" height="32" fill="currentColor" />
    <rect x="8" y="8" width="16" height="16" fill="var(--theme-surface)" />
    <rect x="12" y="12" width="8" height="8" fill="currentColor" />
  </svg>
);

export function Sidebar({ user, onSelectWorkspace, onSelectProject, onEditProject, onDeleteProject, theme, onThemeChange, onLogout, onOpenSettings }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const [expandedProjects, setExpandedProjects] = React.useState<Record<string, boolean>>({});

  const projects = useStore(state => state.projects);
  const currentWorkspaceId = useStore(state => state.currentWorkspaceId);
  const currentProjectId = useStore(state => state.currentProjectId);
  const projectMemory = useStore(state => state.projectMemory);
  const setShowNewProjectModal = useStore(state => state.setShowNewProjectModal);

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }));
  };

  return (
    <motion.div 
      initial={false}
      animate={{ width: isCollapsed ? 80 : 260 }}
      className="bg-theme-bg text-theme-text flex flex-col h-full shrink-0 border-r border-theme-border/50 relative z-20 transition-colors duration-300 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]"
    >
      {/* Collapse Toggle */}
      <button 
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-theme-surface border border-theme-border/50 flex items-center justify-center text-theme-text-muted hover:text-theme-text hover:border-theme-primary transition-colors z-30 shadow-sm rounded-full"
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Logo Section */}
      <div className="h-16 flex items-center px-6 border-b border-theme-border shrink-0 overflow-hidden bg-theme-bg">
        <div className="flex items-center gap-3 min-w-max">
          <SwissLogo />
          {!isCollapsed && (
            <motion.span 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-bold text-theme-text text-lg tracking-tight"
            >
              JetWork
            </motion.span>
          )}
        </div>
      </div>

      {/* Action Section */}
      <div className="p-4 shrink-0 overflow-hidden flex flex-col gap-4">
        {!isCollapsed && (
          <div className="flex bg-theme-surface border border-theme-border rounded-lg p-1">
            <button className="flex-1 text-xs font-semibold py-1.5 bg-theme-surface-hover rounded-md text-theme-text shadow-sm">
              Projelerim
            </button>
            <button className="flex-1 text-xs font-medium py-1.5 text-theme-text-muted hover:text-theme-text transition-colors">
              Paylaşılanlar
            </button>
          </div>
        )}

        {!isCollapsed && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
            <input 
              type="text" 
              placeholder="Proje ara" 
              className="w-full bg-theme-surface border border-theme-border rounded-md pl-9 pr-3 py-2 text-xs text-theme-text placeholder:text-theme-text-muted outline-none focus:border-theme-primary transition-colors"
            />
          </div>
        )}
      </div>

      {/* Projects List */}
      {!isCollapsed && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-6"
        >
          <div>
            <div className="flex items-center justify-between mb-3 px-2">
              <h3 className="text-[11px] font-bold text-theme-text-muted">Projeler</h3>
              <button 
                onClick={() => setShowNewProjectModal(true)}
                className="w-5 h-5 rounded-full bg-theme-surface-hover flex items-center justify-center text-theme-text-muted hover:text-theme-text transition-colors"
                title="Yeni Proje"
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="space-y-1">
              {projects.length === 0 ? (
                <div className="text-[11px] text-theme-text-muted text-center py-4 px-2 bg-theme-surface/50 rounded-lg border border-theme-border/50 border-dashed">
                  Henüz proje yok.
                </div>
              ) : (
                projects.map(project => (
                  <div key={project.id} className="relative group">
                  <div className={cn(
                    "w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-colors text-left",
                    currentProjectId === project.id 
                      ? "bg-theme-surface-hover" 
                      : "hover:bg-theme-surface"
                  )}>
                    <button 
                      onClick={() => toggleProject(project.id)}
                      className="p-1 text-theme-text-muted hover:text-theme-text transition-colors"
                    >
                      <ChevronRight size={14} className={cn("transition-transform", expandedProjects[project.id] && "rotate-90")} />
                    </button>
                    <button 
                      onClick={() => onSelectProject(project.id)}
                      className="flex-1 flex items-center gap-3 min-w-0"
                    >
                      <div className="w-8 h-8 rounded-md bg-theme-surface border border-theme-border flex items-center justify-center shrink-0 group-hover:border-theme-primary/50 transition-colors">
                        <FolderPlus size={14} className={currentProjectId === project.id ? "text-theme-primary" : "text-theme-text-muted"} />
                      </div>
                      <div className="flex-1 min-w-0 pr-12 text-left">
                        <div className={cn(
                          "text-sm font-medium truncate",
                          currentProjectId === project.id ? "text-theme-text" : "text-theme-text-muted group-hover:text-theme-text"
                        )}>
                          {project.name}
                        </div>
                        <div className="text-[10px] text-theme-text-muted flex items-center gap-1 mt-0.5">
                          <Monitor size={10} />
                          {new Date(project.createdAt).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                    </button>
                  </div>
                  
                  <div className="absolute right-2 top-4 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditProject && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onEditProject(project); }}
                        className="p-1.5 text-theme-text-muted hover:text-theme-primary hover:bg-theme-surface rounded-md transition-colors"
                        title="Düzenle"
                      >
                        <Edit2 size={12} />
                      </button>
                    )}
                    {onDeleteProject && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id); }}
                        className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                        title="Sil"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  {/* Workspaces Accordion */}
                  <AnimatePresence>
                    {expandedProjects[project.id] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pl-10 pr-2 py-1 space-y-1 border-l border-theme-border/50 ml-4 mt-1">
                          {project.workspaces.length === 0 ? (
                            <div className="text-[10px] text-theme-text-muted py-2 px-2 bg-theme-surface/30 rounded border border-theme-border/30 border-dashed text-center">
                              Çalışma alanı yok
                            </div>
                          ) : (
                            project.workspaces.map(ws => (
                              <button
                                key={ws.id}
                                onClick={() => onSelectWorkspace(ws.id)}
                                className={cn(
                                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left",
                                  currentWorkspaceId === ws.id
                                    ? "bg-theme-primary/10 text-theme-primary"
                                    : "text-theme-text-muted hover:bg-theme-surface hover:text-theme-text"
                                )}
                              >
                                <FileText size={12} className="shrink-0" />
                                <span className="text-xs font-medium truncate">{ws.title}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                ))
              )}
            </div>
          </div>

          {/* Project Memory Section */}
          {Object.keys(projectMemory).length > 0 && (
            <div className="mt-auto mb-4">
              <div className="flex items-center gap-2 mb-3 px-2">
                <BrainCircuit size={14} className="text-theme-primary" />
                <h3 className="text-[11px] font-bold text-theme-text-muted uppercase tracking-wider">Proje Hafızası</h3>
              </div>
              <div className="bg-theme-surface/50 border border-theme-border rounded-lg p-3 space-y-2">
                {Object.entries(projectMemory).map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-theme-text-muted font-medium">{key}</span>
                    <span className="text-xs text-theme-text font-semibold">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* User Section */}
      <div className="p-4 border-t border-theme-border shrink-0 bg-theme-bg overflow-visible relative">
        <div className={cn("flex items-center gap-3", isCollapsed ? "justify-center" : "px-2")}>
          <div className="w-8 h-8 bg-theme-surface flex items-center justify-center text-theme-text font-bold shrink-0 border border-theme-border text-xs rounded-full">
            {user?.name?.charAt(0) || 'U'}
          </div>
          {!isCollapsed && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 min-w-0"
            >
              <div className="text-xs font-bold text-theme-text truncate">{user?.name || 'Kullanıcı'}</div>
              <div className="text-[9px] text-theme-text-muted uppercase tracking-widest font-semibold">{user?.role || 'Rol'}</div>
            </motion.div>
          )}
          {!isCollapsed && (
            <div className="relative">
              <button 
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="text-theme-text-muted hover:text-theme-text transition-colors p-1 rounded-md hover:bg-theme-surface"
              >
                <Settings size={14} />
              </button>
              
              <AnimatePresence>
                {showUserMenu && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full right-0 mb-2 w-48 bg-theme-surface border border-theme-border shadow-lg rounded-md overflow-hidden z-50"
                  >
                    <div className="text-[10px] font-bold text-theme-text-muted uppercase tracking-widest px-3 py-2 border-b border-theme-border">
                      Hesap & Ayarlar
                    </div>
                    
                    <button 
                      onClick={() => { onOpenSettings(); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-theme-surface-hover transition-colors flex items-center gap-2 text-theme-text"
                    >
                      <User size={14} />
                      Profil & Ayarlar
                    </button>
                    
                    <div className="w-full h-px bg-theme-border/50 my-1" />
                    
                    <div className="text-[10px] font-bold text-theme-text-muted uppercase tracking-widest px-3 py-2">
                      Tema Seçimi
                    </div>
                    <button 
                      onClick={() => { onThemeChange('monochrome'); setShowUserMenu(false); }}
                      className={cn("w-full text-left px-3 py-2 text-xs hover:bg-theme-surface-hover transition-colors flex items-center gap-2", theme === 'monochrome' && "font-bold text-theme-primary")}
                    >
                      <div className="w-3 h-3 rounded-full bg-zinc-900 border border-zinc-200" />
                      Monochrome
                    </button>
                    <button 
                      onClick={() => { onThemeChange('energetic'); setShowUserMenu(false); }}
                      className={cn("w-full text-left px-3 py-2 text-xs hover:bg-theme-surface-hover transition-colors flex items-center gap-2", theme === 'energetic' && "font-bold text-theme-primary")}
                    >
                      <div className="w-3 h-3 rounded-full bg-yellow-500 border border-yellow-200" />
                      Energetic Glass
                    </button>
                    <button 
                      onClick={() => { onThemeChange('ocean'); setShowUserMenu(false); }}
                      className={cn("w-full text-left px-3 py-2 text-xs hover:bg-theme-surface-hover transition-colors flex items-center gap-2", theme === 'ocean' && "font-bold text-theme-primary")}
                    >
                      <div className="w-3 h-3 rounded-full bg-sky-500 border border-sky-200" />
                      Deep Ocean
                    </button>
                    
                    <div className="w-full h-px bg-theme-border/50 my-1" />
                    
                    <button 
                      onClick={() => { onLogout(); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-red-500/10 text-red-500 transition-colors flex items-center gap-2 font-medium"
                    >
                      <LogOut size={14} />
                      Çıkış Yap
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function NavItem({ icon, label, active = false, isCollapsed = false }: { icon: React.ReactNode, label: string, active?: boolean, isCollapsed?: boolean }) {
  return (
    <button className={cn(
      "w-full flex items-center gap-3 px-3 py-2.5 transition-colors group relative rounded-md",
      active ? "bg-theme-surface text-theme-text shadow-sm border border-theme-border/50" : "text-theme-text-muted hover:bg-theme-surface hover:text-theme-text border border-transparent",
      isCollapsed ? "justify-center" : ""
    )}>
      <div className={cn("transition-transform group-hover:scale-110", active ? "text-theme-text" : "")}>
        {icon}
      </div>
      {!isCollapsed && (
        <motion.span 
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-xs font-semibold tracking-wide"
        >
          {label}
        </motion.span>
      )}
    </button>
  );
}
