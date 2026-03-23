import { useEffect } from 'react';
import { db, collection, query, orderBy, onSnapshot } from '../db';
import { Project, Workspace } from '../types';
import { User } from './useAuth';
import { useStore } from '../store/useStore';

export function useProjects(user: User | null, isAuthReady: boolean) {
  const projects = useStore(state => state.projects);
  const setProjects = useStore(state => state.setProjects);

  useEffect(() => {
    if (user && isAuthReady) {
      // Sadece kullanıcının dahil olduğu projeleri ve çalışma alanlarını getir
      const projectsQuery = query(
        collection(db, 'projects'),
        orderBy('createdAt', 'desc')
      );
      
      const workspacesQuery = query(
        collection(db, 'workspaces'),
        orderBy('createdAt', 'desc')
      );

      let unsubscribeWorkspaces: () => void;

      const unsubscribeProjects = onSnapshot(projectsQuery, (projectsSnapshot) => {
        const projectsData = projectsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toMillis() || Date.now(),
          lastUpdated: doc.data().lastUpdated?.toMillis() || Date.now(),
          workspaces: []
        })) as Project[];

        if (unsubscribeWorkspaces) {
          unsubscribeWorkspaces();
        }

        unsubscribeWorkspaces = onSnapshot(workspacesQuery, (workspacesSnapshot) => {
          const workspacesData = workspacesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            issueKey: doc.data().issueKey || `JET-${doc.id.substring(0, 4).toUpperCase()}`,
            createdAt: doc.data().createdAt?.toMillis() || Date.now(),
            lastUpdated: doc.data().lastUpdated?.toMillis() || Date.now(),
            messages: []
          })) as Workspace[];

          const combinedProjects = projectsData.map(p => ({
            ...p,
            workspaces: workspacesData.filter(w => w.projectId === p.id)
          }));

          setProjects(combinedProjects);
        }, (error) => {
          console.error("Error fetching workspaces:", error);
        });
      }, (error) => {
        console.error("Error fetching projects:", error);
      });

      return () => {
        unsubscribeProjects();
        if (unsubscribeWorkspaces) {
          unsubscribeWorkspaces();
        }
      };
    }
  }, [user, isAuthReady, setProjects]);

  return { projects, setProjects };
}
