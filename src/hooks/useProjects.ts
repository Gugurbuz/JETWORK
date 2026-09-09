import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Project, Workspace } from '../types';
import { User } from './useAuth';
import { useDataStore } from '../store/useDataStore';
import { rowsToCamel } from '../lib/mapping';
import type { ProjectWorkspaceGroup } from '../services/projectWorkspaceGroupRepository';

export const STANDALONE_PROJECT_ID = '__jetwork_standalone_chats__';

export type ProjectWithWorkspaceGroups = Project & {
  workspaceGroups?: ProjectWorkspaceGroup[];
};

export type ConversationWorkspace = Workspace & {
  workspaceGroupId?: string | null;
};

async function loadAll(user: User): Promise<Project[]> {
    const [projectsRes, workspacesRes, workspaceGroupsRes] = await Promise.all([
      supabase.from('projects').select('*').order('last_updated', { ascending: false }).limit(500),
      supabase.from('workspaces').select('*').order('last_updated', { ascending: false }).limit(1000),
      supabase.from('project_workspace_groups').select('*').order('position', { ascending: true }).order('last_updated', { ascending: false }).limit(1000),
    ]);

    if (projectsRes.error) throw projectsRes.error;
    if (workspacesRes.error) throw workspacesRes.error;
    if (workspaceGroupsRes.error) throw workspaceGroupsRes.error;

    const projectsData = rowsToCamel<Project>(projectsRes.data).map(p => ({
      ...p,
      workspaces: [] as Workspace[],
    }));

    const workspacesData = rowsToCamel<ConversationWorkspace>(workspacesRes.data).map(w => ({
      ...w,
      projectId: w.projectId || null,
      workspaceGroupId: w.workspaceGroupId || null,
      issueKey: w.issueKey || `JET-${String(w.id).substring(0, 4).toUpperCase()}`,
      messages: [] as any[],
    }));

    const workspaceGroups = rowsToCamel<ProjectWorkspaceGroup>(workspaceGroupsRes.data)
      .filter(group => !group.deletedAt);

    // RLS is authoritative. A project member can see every conversation and
    // workspace group in that project, while standalone chats remain scoped
    // to their owner/collaborators.
    const combinedProjects = projectsData
      .map(p => ({
        ...p,
        workspaces: workspacesData.filter(w => w.projectId === p.id),
        workspaceGroups: workspaceGroups.filter(group => group.projectId === p.id),
      } as ProjectWithWorkspaceGroups))
      .filter(p => p.ownerId === user.uid || p.workspaces.length > 0 || (p.workspaceGroups?.length || 0) > 0);

    const standaloneWorkspaces = workspacesData.filter(w => !w.projectId);
    if (standaloneWorkspaces.length === 0) return combinedProjects;

    const standaloneGroup: ProjectWithWorkspaceGroups = {
      id: STANDALONE_PROJECT_ID,
      name: 'Sohbetler',
      description: 'Herhangi bir projeye bağlı olmayan bağımsız sohbetler.',
      workspaces: standaloneWorkspaces,
      workspaceGroups: [],
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      ownerId: user.uid,
    };

    return [standaloneGroup, ...combinedProjects];
}

export function useProjects(user: User | null, isAuthReady: boolean) {
  const projects = useDataStore(state => state.projects);
  const setProjects = useDataStore(state => state.setProjects);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const reloadProjects = useCallback(async () => {
    if (!user || !isAuthReady) return;
    setIsLoadingProjects(true);
    setProjectsError(null);
    try {
      setProjects(await loadAll(user));
    } catch (error) {
      console.error('Error loading projects/conversations/workspace groups:', error);
      setProjectsError(error instanceof Error ? error.message : 'Projeler yüklenemedi.');
    } finally {
      setIsLoadingProjects(false);
    }
  }, [user, isAuthReady, setProjects]);

  useEffect(() => {
    if (!user || !isAuthReady) return;

    void reloadProjects();

    const channel = supabase
      .channel('projects-workspaces')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        void reloadProjects();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspaces' }, () => {
        void reloadProjects();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_workspace_groups' }, () => {
        void reloadProjects();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAuthReady, reloadProjects]);

  return { projects, setProjects, isLoadingProjects, projectsError, reloadProjects };
}
