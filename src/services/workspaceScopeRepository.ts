import { supabase } from '../supabase';

export async function moveWorkspaceToProject(workspaceId: string, projectId: string): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .update({
      project_id: projectId,
      last_updated: new Date().toISOString(),
    })
    .eq('id', workspaceId)
    .is('project_id', null)
    .select('id')
    .single();

  if (error) throw error;
}
