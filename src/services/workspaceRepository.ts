import { supabase } from '../supabase';
import type { DocumentData } from '../types';

export function isWorkspaceResultCurrent(requestedWorkspaceId: string, currentWorkspaceId: string | null): boolean {
  return requestedWorkspaceId === currentWorkspaceId;
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function loadWorkspaceDocument(workspaceId: string): Promise<DocumentData | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('content')
    .eq('id', 'main')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data?.content as DocumentData | null) ?? null;
}
