import React from 'react';
import { SettingsModal } from './SettingsModal';
import { NewItemModal } from './NewItemModal';
import { NewProjectModal } from './NewProjectModal';
import { ManageParticipantsModal } from './ManageParticipantsModal';
import { EditProjectModal } from './EditProjectModal';
import { EditWorkspaceModal } from './EditWorkspaceModal';
import { ConfirmModal } from './ConfirmModal';
import { User } from '../hooks/useAuth';
import { useDataStore } from '../store/useDataStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';

interface ModalsContainerProps {
  user: User | null;
  handleUpdateUser: (updatedUser: { name: string; role: string; color?: string }) => Promise<void>;
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
  const projects = useDataStore(state => state.projects);
  const currentProjectId = useDataStore(state => state.currentProjectId);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const selectedModel = useSettingsStore(state => state.selectedModel);
  const setSelectedModel = useSettingsStore(state => state.setSelectedModel);
  const showSettingsModal = useUIStore(state => state.showSettingsModal);
  const setShowSettingsModal = useUIStore(state => state.setShowSettingsModal);
  const showNewItemModal = useUIStore(state => state.showNewItemModal);
  const setShowNewItemModal = useUIStore(state => state.setShowNewItemModal);
  const showNewProjectModal = useUIStore(state => state.showNewProjectModal);
  const setShowNewProjectModal = useUIStore(state => state.setShowNewProjectModal);
  const showManageParticipantsModal = useUIStore(state => state.showManageParticipantsModal);
  const setShowManageParticipantsModal = useUIStore(state => state.setShowManageParticipantsModal);
  const editingProject = useUIStore(state => state.editingProject);
  const setEditingProject = useUIStore(state => state.setEditingProject);
  const editingWorkspace = useUIStore(state => state.editingWorkspace);
  const setEditingWorkspace = useUIStore(state => state.setEditingWorkspace);
  const deletingProject = useUIStore(state => state.deletingProject);
  const setDeletingProject = useUIStore(state => state.setDeletingProject);
  const deletingWorkspace = useUIStore(state => state.deletingWorkspace);
  const setDeletingWorkspace = useUIStore(state => state.setDeletingWorkspace);

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
          message="Bu proje çöp kutusuna taşınacak. Daha sonra geri yükleyebilirsiniz."
          confirmText="Çöp kutusuna taşı"
          onConfirm={handleDeleteProject}
          onCancel={() => setDeletingProject(null)}
        />
      )}
      {deletingWorkspace && (
        <ConfirmModal
          title="Çalışma Alanını Sil"
          message="Bu çalışma alanı çöp kutusuna taşınacak. Daha sonra geri yükleyebilirsiniz."
          confirmText="Çöp kutusuna taşı"
          onConfirm={handleDeleteWorkspace}
          onCancel={() => setDeletingWorkspace(null)}
        />
      )}
    </>
  );
}
