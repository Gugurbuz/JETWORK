import { useEffect } from 'react';
import { supabase } from '../supabase';
import { Project, Workspace } from '../types';
import { User } from './useAuth';
import { useStore } from '../store/useStore';
import { rowsToCamel } from '../lib/mapping';

async function loadAll(user: User, setProjects: (projects: Project[]) => void) {
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

    const myWorkspaces = workspacesData.filter(w =>
      w.ownerId === user.uid ||
      (w.collaborators && w.collaborators.some((c: any) => c.email === user.email))
    );

    const combinedProjects = projectsData
      .map(p => ({
        ...p,
        workspaces: myWorkspaces.filter(w => w.projectId === p.id),
      }))
      .filter(p => p.ownerId === user.uid || p.workspaces.length > 0);

    setProjects(combinedProjects);
  } catch (error) {
    console.error('Error loading projects/workspaces:', error);
  }
}

export function useProjects(user: User | null, isAuthReady: boolean) {
  const projects = useStore(state => state.projects);
  const setProjects = useStore(state => state.setProjects);

  useEffect(() => {
    if (!user || !isAuthReady) return;

    loadAll(user, setProjects);

    const channel = supabase
      .channel('projects-workspaces')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        loadAll(user, setProjects);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspaces' }, () => {
        loadAll(user, setProjects);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAuthReady, setProjects]);

  return { projects, setProjects };
}
