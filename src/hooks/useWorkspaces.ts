import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { supabase } from '../supabase';
import { Project, Workspace } from '../types';
import { rowsToCamel } from '../lib/mapping';

async function loadAll(setProjects: (projects: Project[]) => void) {
  try {
    const [projectsRes, workspacesRes] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('workspaces').select('*').order('created_at', { ascending: false }),
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

    const combinedProjects = projectsData.map(p => ({
      ...p,
      workspaces: workspacesData.filter(w => w.projectId === p.id),
    }));

    setProjects(combinedProjects);
  } catch (error) {
    console.error('Error loading projects/workspaces:', error);
  }
}

export const useWorkspaces = () => {
  const { user, isAuthReady, setProjects } = useStore();

  useEffect(() => {
    if (!user || !isAuthReady) return;

    loadAll(setProjects);

    const channel = supabase
      .channel('all-projects-workspaces')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        loadAll(setProjects);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspaces' }, () => {
        loadAll(setProjects);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAuthReady, setProjects]);
};
