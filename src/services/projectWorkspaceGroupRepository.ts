import { supabase } from '../supabase';
import { nowIso } from '../lib/mapping';

export interface ProjectWorkspaceGroup {
  id: string;
  projectId: string;
  name: string;
  ownerId: string;
  position: number;
  createdAt: number | string;
  lastUpdated: number | string;
  archivedAt?: string | null;
  deletedAt?: string | null;
}

export interface ConversationWithWorkspaceGroup {
  workspaceGroupId?: string | null;
}

export async function createProjectWorkspaceGroup(
  projectId: string,
  name: string,
  ownerId: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const { error } = await supabase
    .from('project_workspace_groups')
    .insert({
      id,
      project_id: projectId,
      name: name.trim(),
      owner_id: ownerId,
      created_at: timestamp,
      last_updated: timestamp,
    })
    .select('id')
    .single();

  if (error) throw error;
  return id;
}

export async function renameProjectWorkspaceGroup(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('project_workspace_groups')
    .update({ name: name.trim(), last_updated: nowIso() })
    .eq('id', id)
    .select('id')
    .single();

  if (error) throw error;
}

export async function deleteProjectWorkspaceGroup(id: string): Promise<void> {
  const { error } = await supabase
    .from('project_workspace_groups')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function setConversationWorkspaceGroup(
  conversationId: string,
  workspaceGroupId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .update({ workspace_group_id: workspaceGroupId, last_updated: nowIso() })
    .eq('id', conversationId)
    .select('id')
    .single();

  if (error) throw error;
}
