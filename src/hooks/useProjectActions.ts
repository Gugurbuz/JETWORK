import { useStore } from '../store/useStore';
import { db, collection, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion, arrayRemove } from '../db';
import { Project, Workspace, Collaborator } from '../types';

export const useProjectActions = () => {
  const { 
    user, 
    projects, 
    currentWorkspaceId, 
    setCurrentWorkspaceId, 
    setCurrentProjectId,
    setShowNewProjectModal,
    setShowNewItemModal,
    setEditingProject,
    setEditingWorkspace,
    setDeletingProject,
    setDeletingWorkspace,
    setShowManageParticipantsModal
  } = useStore();

  const handleNewProject = async (name: string, description: string) => {
    if (!user) return;
    try {
      const newProjectRef = doc(collection(db, 'projects'));
      await setDoc(newProjectRef, {
        name,
        description,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });
      setShowNewProjectModal(false);
      setCurrentProjectId(newProjectRef.id);
    } catch (error) {
      console.error("Error creating project:", error);
    }
  };

  const handleNewWorkspace = async (title: string, description: string, projectId: string) => {
    if (!user) return;
    try {
      const newWorkspaceRef = doc(collection(db, 'workspaces'));
      const issueKey = `JET-${newWorkspaceRef.id.substring(0, 4).toUpperCase()}`;
      
      await setDoc(newWorkspaceRef, {
        projectId,
        title,
        description,
        issueKey,
        status: 'To Do',
        ownerId: user.uid,
        collaborators: [{
          uid: user.uid,
          email: user.email || '',
          displayName: user.name,
          photoURL: user.photoURL || '',
          role: 'owner',
          joinedAt: Date.now()
        }],
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });

      setShowNewItemModal(false);
      setCurrentProjectId(projectId);
      setCurrentWorkspaceId(newWorkspaceRef.id);
    } catch (error) {
      console.error("Error creating workspace:", error);
    }
  };

  const handleEditProject = async (id: string, name: string, description: string) => {
    try {
      await updateDoc(doc(db, 'projects', id), {
        name,
        description,
        lastUpdated: serverTimestamp()
      });
      setEditingProject(null);
    } catch (error) {
      console.error("Error updating project:", error);
    }
  };

  const handleEditWorkspace = async (id: string, title: string, description: string) => {
    try {
      await updateDoc(doc(db, 'workspaces', id), {
        title,
        description,
        lastUpdated: serverTimestamp()
      });
      setEditingWorkspace(null);
    } catch (error) {
      console.error("Error updating workspace:", error);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      const project = projects.find(p => p.id === id);
      if (project) {
        for (const workspace of project.workspaces) {
          await deleteDoc(doc(db, 'workspaces', workspace.id));
        }
      }
      await deleteDoc(doc(db, 'projects', id));
      setDeletingProject(null);
      if (currentProjectId === id) {
        setCurrentProjectId(null);
        setCurrentWorkspaceId(null);
      }
    } catch (error) {
      console.error("Error deleting project:", error);
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'workspaces', id));
      setDeletingWorkspace(null);
      if (currentWorkspaceId === id) {
        setCurrentWorkspaceId(null);
      }
    } catch (error) {
      console.error("Error deleting workspace:", error);
    }
  };

  const handleAddParticipant = async (email: string, role: 'editor' | 'viewer') => {
    if (!currentWorkspaceId) return;
    try {
      const newCollaborator: Collaborator = {
        uid: `temp_${Date.now()}`,
        email,
        displayName: email.split('@')[0],
        photoURL: '',
        role,
        joinedAt: Date.now()
      };
      
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        collaborators: arrayUnion(newCollaborator)
      });
    } catch (error) {
      console.error("Error adding participant:", error);
    }
  };

  const handleRemoveParticipant = async (uid: string) => {
    if (!currentWorkspaceId) return;
    try {
      const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);
      const collaboratorToRemove = currentWorkspace?.collaborators?.find(c => c.uid === uid);
      
      if (collaboratorToRemove) {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
          collaborators: arrayRemove(collaboratorToRemove)
        });
      }
    } catch (error) {
      console.error("Error removing participant:", error);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!currentWorkspaceId || !user) return;
    try {
      const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);
      const currentUserCollaborator = currentWorkspace?.collaborators?.find(c => c.uid === user.uid);
      
      if (currentUserCollaborator) {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
          collaborators: arrayRemove(currentUserCollaborator)
        });
        setShowManageParticipantsModal(false);
        setCurrentWorkspaceId(null);
      }
    } catch (error) {
      console.error("Error leaving workspace:", error);
    }
  };

  const handleSelectWorkspace = (id: string) => {
    setCurrentWorkspaceId(id);
    setCurrentProjectId(null);
    useStore.getState().setTypingUsers([]);
  };

  const handleSelectProject = (id: string) => {
    setCurrentProjectId(id);
    setCurrentWorkspaceId(null);
  };

  return {
    handleNewProject,
    handleNewWorkspace,
    handleEditProject,
    handleEditWorkspace,
    handleDeleteProject,
    handleDeleteWorkspace,
    handleAddParticipant,
    handleRemoveParticipant,
    handleLeaveWorkspace,
    handleSelectWorkspace,
    handleSelectProject
  };
};
