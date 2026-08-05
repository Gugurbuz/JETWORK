import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Project, Workspace } from '../types';
import { User } from './useAuth';
import { useDataStore } from '../store/useDataStore';
import { rowsToCamel } from '../lib/mapping';

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
      issueKey: w.issueKey || `JET-${String(w.id).substring(0, 4).toUpperCase()}`,
      messages: [] as any[],
    }));

    const myWorkspaces = workspacesData.filter(w =>
      w.ownerId === user.uid ||
      (w.collaborators && w.collaborators.some((c: any) => c.id === user.uid || c.email === user.email))
    );

    const combinedProjects = projectsData
      .map(p => ({
        ...p,
        workspaces: myWorkspaces.filter(w => w.projectId === p.id),
      }))
      .filter(p => p.ownerId === user.uid || p.workspaces.length > 0);

    return combinedProjects;
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
