import { supabase } from '../supabase';
import { Workspace, Message } from '../types';
import { User } from './useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useUIStore } from '../store/useUIStore';
import { toast } from 'sonner';
import { nowIso } from '../lib/mapping';

export function useWorkspaceHandlers(
  user: User | null,
  currentWorkspace: Workspace | undefined,
  messages: Message[]
) {
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const setCurrentWorkspaceId = useDataStore(state => state.setCurrentWorkspaceId);
  const currentProjectId = useDataStore(state => state.currentProjectId);
  const setCurrentProjectId = useDataStore(state => state.setCurrentProjectId);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const setShowNewItemModal = useUIStore(state => state.setShowNewItemModal);
  const setEditingProject = useUIStore(state => state.setEditingProject);
  const setEditingWorkspace = useUIStore(state => state.setEditingWorkspace);
  const deletingProject = useUIStore(state => state.deletingProject);
  const setDeletingProject = useUIStore(state => state.setDeletingProject);
  const deletingWorkspace = useUIStore(state => state.deletingWorkspace);
  const setDeletingWorkspace = useUIStore(state => state.setDeletingWorkspace);
  const setShowManageParticipantsModal = useUIStore(state => state.setShowManageParticipantsModal);
  const setDocumentContent = useDocumentStore(state => state.setDocumentContent);

  const handleNewProject = async (data: { name: string; description: string }) => {
    if (!user) return;
    const newId = crypto.randomUUID();

    try {
      const { error } = await supabase.from('projects').insert({
        id: newId,
        name: data.name,
        description: data.description,
        owner_id: user.uid,
        created_at: nowIso(),
        last_updated: nowIso(),
      }).select('id').single();
      if (error) throw error;
    } catch (err) {
      console.error('Failed to create project in database:', err);
      toast.error('Proje kaydedilemedi. Lütfen tekrar deneyin.');
      return;
    }

    setShowNewProjectModal(false);
    setCurrentProjectId(newId);
    setCurrentWorkspaceId(null);
  };

  const handleNewWorkspace = async (data: { projectId: string; itemNumber: string; title: string; team: { id: string; name: string; role: string; email: string }[] }) => {
    if (!user) return;
    const newId = crypto.randomUUID();

    const ownerCollab = {
      id: user.uid,
      name: user.name || user.email?.split('@')[0] || 'Unknown',
      role: 'Kurucu',
      avatar: user.photoURL || undefined,
      color: '#4f46e5',
      email: user.email,
    };

    const initialCollaborators = data.team.map(t => ({
      id: t.id,
      name: t.name,
      role: t.role,
      color: '#4f46e5',
      email: t.email,
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
        title_source: 'user',
        type: 'Development',
        status: 'Draft',
        owner_id: user.uid,
        collaborators: initialCollaborators,
        created_at: nowIso(),
        last_updated: nowIso(),
      }).select('id').single();
      if (error) throw error;
    } catch (err) {
      console.error('Failed to create workspace in database:', err);
      toast.error('Çalışma alanı kaydedilemedi. Lütfen tekrar deneyin.');
      return;
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
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
    } catch (err) {
      console.error('Failed to update project in database:', err);
      toast.error('Proje güncellenemedi. Lütfen tekrar deneyin.');
      return;
    }
    setEditingProject(null);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    try {
      const { error } = await supabase
        .from('projects')
        .update({ deleted_at: nowIso(), last_updated: nowIso() })
        .eq('id', deletingProject)
        .select('id')
        .single();
      if (error) throw error;
    } catch (err) {
      console.error('Failed to delete project in database:', err);
      toast.error('Proje silinemedi. Lütfen tekrar deneyin.');
      return;
    }
    if (currentProjectId === deletingProject) {
      setCurrentProjectId(null);
      setCurrentWorkspaceId(null);
    }
    setDeletingProject(null);
    toast.success('Proje çöp kutusuna taşındı.');
  };

  const handleEditWorkspace = async (id: string, title: string) => {
    try {
      const { error } = await supabase
        .from('workspaces')
        .update({
          title,
          title_source: 'user',
          title_generated_at: null,
          last_updated: nowIso(),
        })
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
    } catch (err) {
      console.error('Failed to update workspace in database:', err);
      toast.error('Çalışma alanı güncellenemedi. Lütfen tekrar deneyin.');
      return;
    }
    setEditingWorkspace(null);
  };

  const handleDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;
    try {
      const { error } = await supabase
        .from('workspaces')
        .update({ deleted_at: nowIso(), last_updated: nowIso() })
        .eq('id', deletingWorkspace)
        .select('id')
        .single();
      if (error) throw error;
    } catch (err) {
      console.error('Failed to delete workspace in database:', err);
      toast.error('Çalışma alanı silinemedi. Lütfen tekrar deneyin.');
      return;
    }
    if (currentWorkspaceId === deletingWorkspace) {
      setCurrentWorkspaceId(null);
    }
    setDeletingWorkspace(null);
    toast.success('Çalışma alanı çöp kutusuna taşındı.');
  };

  const updateProjectLifecycle = async (
    id: string,
    values: { archived_at?: string | null; deleted_at?: string | null },
  ) => {
    const { error } = await supabase
      .from('projects')
      .update({ ...values, last_updated: nowIso() })
      .eq('id', id);
    if (error) throw error;
  };

  const handleArchiveProject = async (id: string) => {
    try {
      await updateProjectLifecycle(id, { archived_at: nowIso() });
      if (currentProjectId === id) setCurrentProjectId(null);
      toast.success('Proje arşivlendi.');
    } catch (error) {
      console.error('Failed to archive project:', error);
      toast.error('Proje arşivlenemedi.');
    }
  };

  const handleRestoreProject = async (id: string) => {
    try {
      await updateProjectLifecycle(id, { archived_at: null, deleted_at: null });
      toast.success('Proje geri yüklendi.');
    } catch (error) {
      console.error('Failed to restore project:', error);
      toast.error('Proje geri yüklenemedi.');
    }
  };

  const handleQuickStart = async () => {
    if (!user) return;
    const workspaceId = crypto.randomUUID();
    const timestamp = nowIso();
    try {
      const { error: workspaceError } = await supabase.from('workspaces').insert({
        id: workspaceId,
        project_id: null,
        issue_key: `JET-${workspaceId.slice(0, 4).toUpperCase()}`,
        title: 'Yeni sohbet',
        title_source: 'pending',
        type: 'Development',
        status: 'Draft',
        owner_id: user.uid,
        collaborators: [{
          id: user.uid,
          name: user.name || user.email?.split('@')[0] || 'Kullanıcı',
          email: user.email,
          role: 'Kurucu',
          color: '#4f46e5',
        }],
        created_at: timestamp,
        last_updated: timestamp,
      });
      if (workspaceError) throw workspaceError;
      setCurrentProjectId(null);
      setCurrentWorkspaceId(workspaceId);
      useUIStore.getState().setMobileSidebarOpen(false);
    } catch (error) {
      console.error('Failed to start quick chat:', error);
      toast.error('Yeni sohbet başlatılamadı. Lütfen tekrar deneyin.');
    }
  };

  const updateCollaborators = async (workspaceId: string, collaborators: any[]) => {
    const { error } = await supabase
      .from('workspaces')
      .update({ collaborators, last_updated: nowIso() })
      .eq('id', workspaceId);
    if (error) throw error;
  };

  const handleAddParticipant = async (name: string, email: string) => {
    if (!currentWorkspaceId || !currentWorkspace || !user) return;

    if (currentWorkspace.collaborators.some(c => c.email === email)) {
      alert(currentWorkspace.projectId
        ? 'Bu kullanıcı zaten bu çalışma alanında/projede kayıtlı.'
        : 'Bu kullanıcı zaten çalışma alanında.');
      return;
    }

    let newId = '';
    try {
      const { data: userMatch } = await supabase
        .from('users')
        .select('uid')
        .eq('email', email)
        .maybeSingle();
      if (!userMatch?.uid) {
        toast.error('Bu e-posta adresiyle kayıtlı bir JetWork kullanıcısı bulunamadı.');
        return;
      }
      newId = userMatch.uid;
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
      if (currentWorkspace.projectId) {
        const { error: memberError } = await supabase
          .from('project_members')
          .upsert({
            project_id: currentWorkspace.projectId,
            user_id: newId,
            role: 'member',
            added_by: user.uid,
          }, { onConflict: 'project_id,user_id' });
        if (memberError) throw memberError;
      }

      const nextCollaborators = [...(currentWorkspace.collaborators || []), newCollaborator];
      await updateCollaborators(currentWorkspaceId, nextCollaborators);

      const systemMessageId = crypto.randomUUID();
      const { error: msgErr } = await supabase.from('messages').insert({
        id: systemMessageId,
        workspace_id: currentWorkspaceId,
        sender_name: 'Sistem',
        sender_role: 'System',
        text: currentWorkspace.projectId
          ? `**${name}** projeye eklendi ve proje çalışma alanlarına erişim kazandı.`
          : `**${name}** çalışma alanına eklendi.`,
        role: 'system',
        owner_id: user.uid,
        created_at: nowIso(),
      });
      if (msgErr) throw msgErr;

      toast.success(currentWorkspace.projectId
        ? `${name} projeye eklendi.`
        : `${name} başarıyla eklendi.`);
    } catch (err) {
      console.error('Failed to add participant in database:', err);
      toast.error(currentWorkspace.projectId
        ? 'Proje üyesi eklenirken bir hata oluştu.'
        : 'Katılımcı eklenirken bir hata oluştu.');
    }
  };

  const handleRemoveParticipant = async (participantId: string) => {
    if (!currentWorkspaceId || !currentWorkspace) return;

    const nextCollaborators = (currentWorkspace.collaborators || []).filter(c => c.id !== participantId);

    try {
      if (currentWorkspace.projectId) {
        const { error: memberError } = await supabase
          .from('project_members')
          .delete()
          .eq('project_id', currentWorkspace.projectId)
          .eq('user_id', participantId);
        if (memberError) throw memberError;
      }
      await updateCollaborators(currentWorkspaceId, nextCollaborators);
    } catch (err) {
      console.error('Failed to remove participant in database:', err);
      toast.error(currentWorkspace.projectId
        ? 'Proje üyesi çıkarılamadı.'
        : 'Katılımcı çıkarılamadı.');
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!currentWorkspaceId || !currentWorkspace || !user) return;

    const nextCollaborators = (currentWorkspace.collaborators || []).filter(
      c => !(c.id === user.uid || c.email === user.email || c.name === user.name)
    );

    try {
      // Remove the legacy workspace collaborator marker while access is still
      // available, then drop project membership for project-scoped workspaces.
      await updateCollaborators(currentWorkspaceId, nextCollaborators);
      if (currentWorkspace.projectId) {
        const { error: memberError } = await supabase
          .from('project_members')
          .delete()
          .eq('project_id', currentWorkspace.projectId)
          .eq('user_id', user.uid);
        if (memberError) throw memberError;
      }
      setCurrentWorkspaceId(null);
      setShowManageParticipantsModal(false);
    } catch (err) {
      console.error('Failed to leave workspace/project in database:', err);
      toast.error(currentWorkspace.projectId
        ? 'Projeden ayrılamadınız.'
        : 'Çalışma alanından ayrılamadınız.');
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
    handleArchiveProject,
    handleRestoreProject,
    handleQuickStart,
    handleAddParticipant,
    handleRemoveParticipant,
    handleLeaveWorkspace,
    handleToggleReaction,
  };
}
