import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Project, Workspace, Collaborator } from '../types';
import { Folder, Clock, Users, FileText, Plus, Sparkles, ArrowRight, Activity, Edit2, MessageSquare } from 'lucide-react';

interface ProjectDashboardProps {
  project: Project;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
}

export function ProjectDashboard({ project, onSelectWorkspace, onNewWorkspace }: ProjectDashboardProps) {
  const activities = useMemo(() => {
    const acts: any[] = [];
    project.workspaces.forEach(ws => {
      if (ws.collaborators.length > 0) {
        // Created activity
        acts.push({
          id: `act-create-${ws.id}`,
          user: ws.collaborators[0],
          action: 'çalışma alanını oluşturdu',
          targetName: ws.title,
          workspaceId: ws.id,
          timestamp: ws.createdAt,
          type: 'create'
        });
        
        // Updated activity
        if (ws.lastUpdated > ws.createdAt && ws.collaborators.length > 1) {
          acts.push({
            id: `act-update-${ws.id}`,
            user: ws.collaborators[1 % ws.collaborators.length],
            action: 'dokümanı güncelledi',
            targetName: ws.title,
            workspaceId: ws.id,
            timestamp: ws.lastUpdated,
            type: 'update'
          });
        }

        // Commented activity (mock)
        if (ws.messages && ws.messages.length > 2 && ws.collaborators.length > 0) {
           acts.push({
            id: `act-comment-${ws.id}`,
            user: ws.collaborators[ws.collaborators.length - 1],
            action: 'yeni bir mesaj gönderdi',
            targetName: ws.title,
            workspaceId: ws.id,
            timestamp: ws.lastUpdated - 3600000, // 1 hour before last update
            type: 'comment'
          });
        }
      }
    });
    
    return acts.sort((a, b) => b.timestamp - a.timestamp);
  }, [project]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'create': return <Plus size={12} className="text-emerald-500" />;
      case 'update': return <Edit2 size={12} className="text-blue-500" />;
      case 'comment': return <MessageSquare size={12} className="text-amber-500" />;
      default: return <Activity size={12} className="text-theme-text-muted" />;
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds} saniye önce`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} dakika önce`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} saat önce`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} gün önce`;
    return new Date(timestamp).toLocaleDateString('tr-TR');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-theme-bg p-8 flex flex-col items-center justify-start pt-12">
      <div className="w-full max-w-4xl space-y-12">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-theme-border/50 pb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-theme-primary/10 rounded-lg text-theme-primary">
                <Folder size={20} />
              </div>
              <h1 className="text-2xl font-bold text-theme-text tracking-tight">{project.name}</h1>
            </div>
            {project.description && (
              <p className="text-theme-text-muted text-sm max-w-2xl">{project.description}</p>
            )}
          </div>
          <button
            onClick={onNewWorkspace}
            className="flex items-center gap-2 bg-theme-primary hover:bg-theme-primary-hover text-theme-primary-fg px-4 py-2 rounded-md text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus size={16} />
            Yeni Çalışma Alanı
          </button>
        </div>

        {/* Workspaces Grid */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-theme-text flex items-center gap-2">
              <FileText size={18} className="text-theme-text-muted" />
              Çalışma Alanları
            </h2>
            <span className="text-xs font-medium text-theme-text-muted bg-theme-surface px-2 py-1 rounded-md border border-theme-border">
              {project.workspaces.length} Alan
            </span>
          </div>
          
          {project.workspaces.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-theme-text-muted text-sm">Bu projede henüz bir çalışma başlatılmamış.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {project.workspaces.map((workspace, i) => (
                <motion.button
                  key={workspace.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => onSelectWorkspace(workspace.id)}
                  className="bg-theme-surface border border-theme-border hover:border-theme-primary p-5 rounded-xl shadow-sm transition-all text-left group flex flex-col h-full"
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-xs font-bold text-theme-text-muted bg-theme-bg px-2 py-1 rounded">
                      {workspace.issueKey}
                    </span>
                    <span className={`text-[10px] px-2 py-1 uppercase font-bold border rounded-sm ${
                      workspace.type === 'Support' ? "bg-theme-surface text-theme-text-muted border-theme-border" : "bg-theme-primary/10 text-theme-primary border-theme-primary/20"
                    }`}>
                      {workspace.type === 'Development' ? 'Proje' : 'Destek'}
                    </span>
                  </div>
                  
                  <h3 className="text-theme-text font-bold mb-2 group-hover:text-theme-primary transition-colors line-clamp-2">
                    {workspace.title}
                  </h3>
                  
                  <div className="mt-auto pt-4 flex items-center justify-between">
                    <div className="flex -space-x-2">
                      {workspace.collaborators.slice(0, 3).map((c, j) => (
                        <div 
                          key={c.id} 
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-theme-surface text-white bg-${c.color}-500`}
                          title={`${c.name} - ${c.role}`}
                        >
                          {c.avatar}
                        </div>
                      ))}
                      {workspace.collaborators.length > 3 && (
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-theme-surface bg-theme-bg text-theme-text-muted">
                          +{workspace.collaborators.length - 3}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1 text-[10px] text-theme-text-muted font-medium">
                      <Clock size={12} />
                      {new Date(workspace.lastUpdated).toLocaleDateString('tr-TR')}
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="pt-8 border-t border-theme-border/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-theme-text flex items-center gap-2">
              <Activity size={18} className="text-theme-text-muted" />
              Aktivite Akışı
            </h2>
          </div>

          {activities.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-theme-text-muted text-sm">Henüz bir aktivite bulunmuyor.</p>
            </div>
          ) : (
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-theme-border before:to-transparent">
              {activities.map((activity, index) => (
                <div key={activity.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  {/* Icon */}
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-theme-bg bg-theme-surface shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                    {getActivityIcon(activity.type)}
                  </div>
                  
                  {/* Card */}
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-theme-border bg-theme-surface shadow-sm hover:border-theme-primary/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                          style={{ backgroundColor: `var(--color-${activity.user.color}-500)` }}
                        >
                          {activity.user.avatar}
                        </div>
                        <span className="text-sm font-semibold text-theme-text">{activity.user.name}</span>
                      </div>
                      <time className="text-xs font-medium text-theme-text-muted flex items-center gap-1">
                        <Clock size={10} />
                        {formatTimeAgo(activity.timestamp)}
                      </time>
                    </div>
                    <div className="text-sm text-theme-text-muted">
                      <span className="text-theme-text font-medium">"{activity.targetName}"</span> alanında {activity.action}.
                    </div>
                    <button 
                      onClick={() => onSelectWorkspace(activity.workspaceId)}
                      className="mt-3 text-xs font-semibold text-theme-primary hover:underline flex items-center gap-1"
                    >
                      Çalışma alanına git <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
