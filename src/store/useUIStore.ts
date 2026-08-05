import { create } from 'zustand';
import { Project, Workspace } from '../types';

export interface UIState {
  showNewItemModal: boolean;
  showNewProjectModal: boolean;
  showSettingsModal: boolean;
  showManageParticipantsModal: boolean;
  showAISettingsModal: boolean;
  editingProject: Project | null;
  editingWorkspace: Workspace | null;
  deletingProject: string | null;
  deletingWorkspace: string | null;
  mobileSidebarOpen: boolean;
  setShowNewItemModal: (show: boolean) => void;
  setShowNewProjectModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowManageParticipantsModal: (show: boolean) => void;
  setShowAISettingsModal: (show: boolean) => void;
  setEditingProject: (project: Project | null) => void;
  setEditingWorkspace: (workspace: Workspace | null) => void;
  setDeletingProject: (id: string | null) => void;
  setDeletingWorkspace: (id: string | null) => void;
  setMobileSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  showNewItemModal: false,
  showNewProjectModal: false,
  showSettingsModal: false,
  showManageParticipantsModal: false,
  showAISettingsModal: false,
  editingProject: null,
  editingWorkspace: null,
  deletingProject: null,
  deletingWorkspace: null,
  mobileSidebarOpen: false,
  setShowNewItemModal: (show) => set({ showNewItemModal: show }),
  setShowNewProjectModal: (show) => set({ showNewProjectModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowManageParticipantsModal: (show) => set({ showManageParticipantsModal: show }),
  setShowAISettingsModal: (show) => set({ showAISettingsModal: show }),
  setEditingProject: (project) => set({ editingProject: project }),
  setEditingWorkspace: (workspace) => set({ editingWorkspace: workspace }),
  setDeletingProject: (id) => set({ deletingProject: id }),
  setDeletingWorkspace: (id) => set({ deletingWorkspace: id }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
}));
