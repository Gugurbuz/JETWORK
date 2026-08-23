import { supabase } from '../supabase';

export async function setWorkspaceProject(workspaceId: string, projectId: string | null): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .update({
      project_id: projectId,
      last_updated: new Date().toISOString(),
    })
    .eq('id', workspaceId)
    .select('id')
    .single();

  if (error) throw error;
}

export async function moveWorkspaceToProject(workspaceId: string, projectId: string): Promise<void> {
  await setWorkspaceProject(workspaceId, projectId);
}
