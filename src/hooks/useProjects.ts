import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Project, Workspace } from '../types';
import { User } from './useAuth';
import { useDataStore } from '../store/useDataStore';
import { rowsToCamel } from '../lib/mapping';

export const STANDALONE_PROJECT_ID = '__jetwork_standalone_chats__';

async function loadAll(user: User): Promise<Project[]> {
    const [projectsRes, workspacesRes] = await Promise.all([
      supabase.from('projects').select('*').order('last_updated', { ascending: false }).limit(500),
      supabase.from('workspaces').select('*').order('last_updated', { ascending: false }).limit(1000),
    ]);

    if (projectsRes.error) throw projectsRes.error;
    if (workspacesRes.error) throw workspacesRes.error;

    const projectsData = rowsToCamel<Project>(projectsRes.data).map(p => ({
      ...p,
      workspaces: [] as Workspace[],
    }));

    const workspacesData = rowsToCamel<Workspace>(workspacesRes.data).map(w => ({
      ...w,
      projectId: w.projectId || null,
      issueKey: w.issueKey || `JET-${String(w.id).substring(0, 4).toUpperCase()}`,
      messages: [] as any[],
    }));

    // RLS is authoritative. A project member can see every workspace in that
    // project, while standalone workspaces remain owner/collaborator scoped.
    const combinedProjects = projectsData
      .map(p => ({
        ...p,
        workspaces: workspacesData.filter(w => w.projectId === p.id),
      }))
      .filter(p => p.ownerId === user.uid || p.workspaces.length > 0);

    const standaloneWorkspaces = workspacesData.filter(w => !w.projectId);
    if (standaloneWorkspaces.length === 0) return combinedProjects;

    const standaloneGroup: Project = {
      id: STANDALONE_PROJECT_ID,
      name: 'Sohbetler',
      description: 'Herhangi bir projeye bağlı olmayan bağımsız sohbetler.',
      workspaces: standaloneWorkspaces,
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
      console.error('Error loading projects/workspaces:', error);
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAuthReady, reloadProjects]);

  return { projects, setProjects, isLoadingProjects, projectsError, reloadProjects };
}
