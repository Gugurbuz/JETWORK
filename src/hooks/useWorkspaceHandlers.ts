import { db, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, getDocs, arrayUnion, arrayRemove } from '../db';
import { Project, Workspace, DocumentData, Message } from '../types';
import { User } from './useAuth';
import { useStore } from '../store/useStore';

export function useWorkspaceHandlers(
  user: User | null,
  currentWorkspace: Workspace | undefined,
  messages: Message[]
) {
  const currentWorkspaceId = useStore(state => state.currentWorkspaceId);
  const setCurrentWorkspaceId = useStore(state => state.setCurrentWorkspaceId);
  const currentProjectId = useStore(state => state.currentProjectId);
  const setCurrentProjectId = useStore(state => state.setCurrentProjectId);
  const setShowNewProjectModal = useStore(state => state.setShowNewProjectModal);
  const setShowNewItemModal = useStore(state => state.setShowNewItemModal);
  const setEditingProject = useStore(state => state.setEditingProject);
  const setEditingWorkspace = useStore(state => state.setEditingWorkspace);
  const deletingProject = useStore(state => state.deletingProject);
  const setDeletingProject = useStore(state => state.setDeletingProject);
  const deletingWorkspace = useStore(state => state.deletingWorkspace);
  const setDeletingWorkspace = useStore(state => state.setDeletingWorkspace);
  const setShowManageParticipantsModal = useStore(state => state.setShowManageParticipantsModal);
  const setDocumentContent = useStore(state => state.setDocumentContent);
  const selectWorkspace = useStore(state => state.selectWorkspace);
  const selectProject = useStore(state => state.selectProject);

  const handleNewProject = async (data: { name: string; description: string }) => {
    if (!user) return;
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    try {
      await setDoc(doc(db, 'projects', newId), {
        name: data.name,
        description: data.description,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to create project in database:", err);
    }
    
    setShowNewProjectModal(false);
    setCurrentProjectId(newId);
    setCurrentWorkspaceId(null);
  };

  const handleNewWorkspace = async (data: { projectId: string; itemNumber: string; title: string; team: { id: string; name: string; role: string; email: string }[] }) => {
    if (!user) return;
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    const ownerCollab = {
      id: user.uid,
      name: user.name || user.email?.split('@')[0] || 'Unknown',
      role: 'Kurucu',
      avatar: user.photoURL || undefined,
      color: '#4f46e5'
    };

    const initialCollaborators = data.team.map(t => ({
      id: t.id,
      name: t.name,
      role: t.role,
      color: '#4f46e5'
    }));

    if (!initialCollaborators.some(c => c.id === user.uid)) {
      initialCollaborators.unshift(ownerCollab);
    } else {
      const ownerIndex = initialCollaborators.findIndex(c => c.id === user.uid);
      if (ownerIndex !== -1) {
        initialCollaborators[ownerIndex].role = 'Kurucu';
      }
    }

    try {
      await setDoc(doc(db, 'workspaces', newId), {
        projectId: data.projectId,
        issueKey: data.itemNumber,
        title: data.title,
        type: 'Development',
        status: 'Draft',
        ownerId: user.uid,
        collaborators: initialCollaborators,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to create workspace in database:", err);
    }

    setShowNewItemModal(false);
    setCurrentWorkspaceId(newId);
    setCurrentProjectId(null);
    setDocumentContent(null);
  };

  const handleEditProject = async (id: string, name: string, description: string) => {
    try {
      await updateDoc(doc(db, 'projects', id), {
        name,
        description,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to update project in database:", err);
    }
    setEditingProject(null);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    try {
      await deleteDoc(doc(db, 'projects', deletingProject));
    } catch (err) {
      console.error("Failed to delete project in database:", err);
    }
    if (currentProjectId === deletingProject) {
      setCurrentProjectId(null);
      setCurrentWorkspaceId(null);
    }
    setDeletingProject(null);
  };

  const handleEditWorkspace = async (id: string, title: string) => {
    try {
      await updateDoc(doc(db, 'workspaces', id), {
        title,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to update workspace in database:", err);
    }
    setEditingWorkspace(null);
  };

  const handleDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;
    try {
      await deleteDoc(doc(db, 'workspaces', deletingWorkspace));
    } catch (err) {
      console.error("Failed to delete workspace in database:", err);
    }
    if (currentWorkspaceId === deletingWorkspace) {
      setCurrentWorkspaceId(null);
    }
    setDeletingWorkspace(null);
  };

  const handleAddParticipant = async (name: string, email: string) => {
    if (!currentWorkspaceId || !currentWorkspace) return;
    
    if (currentWorkspace.collaborators.some(c => c.email === email)) {
      alert("Bu kullanıcı zaten çalışma alanında.");
      return;
    }

    let newId = Math.random().toString(36).substring(2, 9);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const existingUser = usersSnap.docs.find(doc => doc.data().email === email);
      if (existingUser) {
        newId = existingUser.id;
      }
    } catch (err) {
      console.error("Failed to fetch users for participant ID:", err);
    }

    const newCollaborator = {
      id: newId,
      name: name,
      email: email,
      role: 'Katılımcı',
      color: '#4f46e5'
    };

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        collaborators: arrayUnion(newCollaborator),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to add participant in database:", err);
    }
  };

  const handleRemoveParticipant = async (participantId: string) => {
    if (!currentWorkspaceId || !currentWorkspace) return;
    
    const participantToRemove = currentWorkspace.collaborators.find(c => c.id === participantId);
    if (!participantToRemove) return;

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        collaborators: arrayRemove(participantToRemove),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to remove participant in database:", err);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!currentWorkspaceId || !currentWorkspace || !user) return;
    
    const currentUserCollab = currentWorkspace.collaborators.find(c => c.id === user.uid || c.email === user.email || c.name === user.name);
    
    if (currentUserCollab) {
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
          collaborators: arrayRemove(currentUserCollab),
          lastUpdated: serverTimestamp()
        });
        setCurrentWorkspaceId(null);
        setShowManageParticipantsModal(false);
      } catch (err) {
        console.error("Failed to leave workspace in database:", err);
      }
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !currentWorkspaceId) return;
    
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || [];
    const existingReactionIndex = currentReactions.findIndex(r => r.emoji === emoji);
    
    let newReactions = [...currentReactions];
    
    if (existingReactionIndex >= 0) {
      const reaction = newReactions[existingReactionIndex];
      if (reaction.users.includes(user.name)) {
        reaction.users = reaction.users.filter(u => u !== user.name);
        if (reaction.users.length === 0) {
          newReactions.splice(existingReactionIndex, 1);
        }
      } else {
        reaction.users.push(user.name);
      }
    } else {
      newReactions.push({ emoji, users: [user.name] });
    }

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', messageId), {
        reactions: newReactions
      });
    } catch (err) {
      console.error("Failed to update reaction in database:", err);
    }
  };

  return {
    handleNewProject,
    handleNewWorkspace,
    handleEditProject,
    handleDeleteProject,
    handleEditWorkspace,
    handleDeleteWorkspace,
    handleAddParticipant,
    handleRemoveParticipant,
    handleLeaveWorkspace,
    handleToggleReaction
  };
}
