import { supabase } from '../supabase';
import { Workspace, Message } from '../types';
import { User } from './useAuth';
import { useStore } from '../store/useStore';
import { toast } from 'sonner';
import { nowIso } from '../lib/mapping';

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

  const handleNewProject = async (data: { name: string; description: string }) => {
    if (!user) return;
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);

    try {
      const { error } = await supabase.from('projects').insert({
        id: newId,
        name: data.name,
        description: data.description,
        owner_id: user.uid,
        created_at: nowIso(),
        last_updated: nowIso(),
      });
      if (error) throw error;
    } catch (err) {
      console.error('Failed to create project in database:', err);
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
      color: '#4f46e5',
    };

    const initialCollaborators = data.team.map(t => ({
      id: t.id,
      name: t.name,
      role: t.role,
      color: '#4f46e5',
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
      const { error } = await supabase.from('workspaces').insert({
        id: newId,
        project_id: data.projectId,
        issue_key: data.itemNumber,
        title: data.title,
        type: 'Development',
        status: 'Draft',
        owner_id: user.uid,
        collaborators: initialCollaborators,
        created_at: nowIso(),
        last_updated: nowIso(),
      });
      if (error) throw error;
    } catch (err) {
      console.error('Failed to create workspace in database:', err);
    }

    setShowNewItemModal(false);
    setCurrentWorkspaceId(newId);
    setCurrentProjectId(null);
    setDocumentContent(null);
  };

  const handleEditProject = async (id: string, name: string, description: string) => {
    try {
      const { error } = await supabase
        .from('projects')
        .update({ name, description, last_updated: nowIso() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to update project in database:', err);
    }
    setEditingProject(null);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    try {
      const { error } = await supabase.from('projects').delete().eq('id', deletingProject);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to delete project in database:', err);
    }
    if (currentProjectId === deletingProject) {
      setCurrentProjectId(null);
      setCurrentWorkspaceId(null);
    }
    setDeletingProject(null);
  };

  const handleEditWorkspace = async (id: string, title: string) => {
    try {
      const { error } = await supabase
        .from('workspaces')
        .update({ title, last_updated: nowIso() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to update workspace in database:', err);
    }
    setEditingWorkspace(null);
  };

  const handleDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;
    try {
      const { error } = await supabase.from('workspaces').delete().eq('id', deletingWorkspace);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to delete workspace in database:', err);
    }
    if (currentWorkspaceId === deletingWorkspace) {
      setCurrentWorkspaceId(null);
    }
    setDeletingWorkspace(null);
  };

  const updateCollaborators = async (workspaceId: string, collaborators: any[]) => {
    const { error } = await supabase
      .from('workspaces')
      .update({ collaborators, last_updated: nowIso() })
      .eq('id', workspaceId);
    if (error) throw error;
  };

  const handleAddParticipant = async (name: string, email: string) => {
    if (!currentWorkspaceId || !currentWorkspace) return;

    if (currentWorkspace.collaborators.some(c => c.email === email)) {
      alert('Bu kullanıcı zaten çalışma alanında.');
      return;
    }

    let newId = Math.random().toString(36).substring(2, 9);
    try {
      const { data: userMatch } = await supabase
        .from('users')
        .select('uid')
        .eq('email', email)
        .maybeSingle();
      if (userMatch?.uid) newId = userMatch.uid;
    } catch (err) {
      console.error('Failed to fetch users for participant ID:', err);
    }

    const newCollaborator = {
      id: newId,
      name,
      email,
      role: 'Katılımcı',
      color: '#4f46e5',
    };

    try {
      const nextCollaborators = [...(currentWorkspace.collaborators || []), newCollaborator];
      await updateCollaborators(currentWorkspaceId, nextCollaborators);

      const systemMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
      const { error: msgErr } = await supabase.from('messages').insert({
        id: systemMessageId,
        workspace_id: currentWorkspaceId,
        sender_name: 'Sistem',
        sender_role: 'System',
        text: `**${name}** çalışma alanına eklendi.`,
        role: 'system',
        created_at: nowIso(),
      });
      if (msgErr) throw msgErr;

      toast.success(`${name} başarıyla eklendi.`);
    } catch (err) {
      console.error('Failed to add participant in database:', err);
      toast.error('Katılımcı eklenirken bir hata oluştu.');
    }
  };

  const handleRemoveParticipant = async (participantId: string) => {
    if (!currentWorkspaceId || !currentWorkspace) return;

    const nextCollaborators = (currentWorkspace.collaborators || []).filter(c => c.id !== participantId);

    try {
      await updateCollaborators(currentWorkspaceId, nextCollaborators);
    } catch (err) {
      console.error('Failed to remove participant in database:', err);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!currentWorkspaceId || !currentWorkspace || !user) return;

    const nextCollaborators = (currentWorkspace.collaborators || []).filter(
      c => !(c.id === user.uid || c.email === user.email || c.name === user.name)
    );

    try {
      await updateCollaborators(currentWorkspaceId, nextCollaborators);
      setCurrentWorkspaceId(null);
      setShowManageParticipantsModal(false);
    } catch (err) {
      console.error('Failed to leave workspace in database:', err);
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !currentWorkspaceId) return;

    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || [];
    const existingReactionIndex = currentReactions.findIndex(r => r.emoji === emoji);

    const newReactions = [...currentReactions];

    if (existingReactionIndex >= 0) {
      const reaction = { ...newReactions[existingReactionIndex], users: [...newReactions[existingReactionIndex].users] };
      if (reaction.users.includes(user.name)) {
        reaction.users = reaction.users.filter(u => u !== user.name);
        if (reaction.users.length === 0) {
          newReactions.splice(existingReactionIndex, 1);
        } else {
          newReactions[existingReactionIndex] = reaction;
        }
      } else {
        reaction.users.push(user.name);
        newReactions[existingReactionIndex] = reaction;
      }
    } else {
      newReactions.push({ emoji, users: [user.name] });
    }

    try {
      const { error } = await supabase
        .from('messages')
        .update({ reactions: newReactions })
        .eq('id', messageId)
        .eq('workspace_id', currentWorkspaceId);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to update reaction in database:', err);
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
    handleToggleReaction,
  };
}
