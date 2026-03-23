import React from 'react';
import { SettingsModal } from './SettingsModal';
import { NewItemModal } from './NewItemModal';
import { NewProjectModal } from './NewProjectModal';
import { ManageParticipantsModal } from './ManageParticipantsModal';
import { EditProjectModal } from './EditProjectModal';
import { EditWorkspaceModal } from './EditWorkspaceModal';
import { ConfirmModal } from './ConfirmModal';
import { User } from '../hooks/useAuth';
import { useStore } from '../store/useStore';

interface ModalsContainerProps {
  user: User | null;
  handleUpdateUser: (updatedUser: { name: string; role: string }) => Promise<void>;
  handleNewWorkspace: (data: { projectId: string; itemNumber: string; title: string; team: { id: string; name: string; role: string; email: string; }[] }) => Promise<void>;
  handleNewProject: (data: { name: string; description: string }) => Promise<void>;
  handleAddParticipant: (name: string, email: string) => Promise<void>;
  handleRemoveParticipant: (collaboratorId: string) => Promise<void>;
  handleLeaveWorkspace: () => Promise<void>;
  handleEditProject: (id: string, name: string, description: string) => Promise<void>;
  handleEditWorkspace: (id: string, title: string) => Promise<void>;
  handleDeleteProject: () => Promise<void>;
  handleDeleteWorkspace: () => Promise<void>;
}

export function ModalsContainer({
  user,
  handleUpdateUser,
  handleNewWorkspace,
  handleNewProject,
  handleAddParticipant,
  handleRemoveParticipant,
  handleLeaveWorkspace,
  handleEditProject,
  handleEditWorkspace,
  handleDeleteProject,
  handleDeleteWorkspace
}: ModalsContainerProps) {
  const projects = useStore(state => state.projects);
  const currentProjectId = useStore(state => state.currentProjectId);
  const currentWorkspaceId = useStore(state => state.currentWorkspaceId);
  const selectedModel = useStore(state => state.selectedModel);
  const setSelectedModel = useStore(state => state.setSelectedModel);
  const showSettingsModal = useStore(state => state.showSettingsModal);
  const setShowSettingsModal = useStore(state => state.setShowSettingsModal);
  const showNewItemModal = useStore(state => state.showNewItemModal);
  const setShowNewItemModal = useStore(state => state.setShowNewItemModal);
  const showNewProjectModal = useStore(state => state.showNewProjectModal);
  const setShowNewProjectModal = useStore(state => state.setShowNewProjectModal);
  const showManageParticipantsModal = useStore(state => state.showManageParticipantsModal);
  const setShowManageParticipantsModal = useStore(state => state.setShowManageParticipantsModal);
  const editingProject = useStore(state => state.editingProject);
  const setEditingProject = useStore(state => state.setEditingProject);
  const editingWorkspace = useStore(state => state.editingWorkspace);
  const setEditingWorkspace = useStore(state => state.setEditingWorkspace);
  const deletingProject = useStore(state => state.deletingProject);
  const setDeletingProject = useStore(state => state.setDeletingProject);
  const deletingWorkspace = useStore(state => state.deletingWorkspace);
  const setDeletingWorkspace = useStore(state => state.setDeletingWorkspace);

  const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);

  return (
    <>
      {showSettingsModal && (
        <SettingsModal 
          user={user}
          onClose={() => setShowSettingsModal(false)}
          onUpdateUser={handleUpdateUser}
          selectedModel={selectedModel}
          onUpdateModel={(model) => {
            setSelectedModel(model);
            localStorage.setItem('jetwork-model', model);
          }}
        />
      )}
      {showNewItemModal && (
        <NewItemModal 
          projects={projects}
          currentProjectId={currentProjectId}
          onClose={() => setShowNewItemModal(false)} 
          onSubmit={handleNewWorkspace} 
        />
      )}
      {showNewProjectModal && (
        <NewProjectModal 
          onClose={() => setShowNewProjectModal(false)} 
          onSubmit={handleNewProject} 
        />
      )}
      {showManageParticipantsModal && currentWorkspace && user && (
        <ManageParticipantsModal
          collaborators={currentWorkspace.collaborators}
          currentUserId={user.uid}
          ownerId={currentWorkspace.ownerId}
          onClose={() => setShowManageParticipantsModal(false)}
          onAddParticipant={handleAddParticipant}
          onRemoveParticipant={handleRemoveParticipant}
          onLeaveWorkspace={handleLeaveWorkspace}
        />
      )}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSubmit={handleEditProject}
        />
      )}
      {editingWorkspace && (
        <EditWorkspaceModal
          workspace={editingWorkspace}
          onClose={() => setEditingWorkspace(null)}
          onSubmit={handleEditWorkspace}
        />
      )}
      {deletingProject && (
        <ConfirmModal
          title="Projeyi Sil"
          message="Bu projeyi ve içindeki tüm çalışma alanlarını silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          confirmText="Sil"
          onConfirm={handleDeleteProject}
          onCancel={() => setDeletingProject(null)}
        />
      )}
      {deletingWorkspace && (
        <ConfirmModal
          title="Çalışma Alanını Sil"
          message="Bu çalışma alanını silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          confirmText="Sil"
          onConfirm={handleDeleteWorkspace}
          onCancel={() => setDeletingWorkspace(null)}
        />
      )}
    </>
  );
}
