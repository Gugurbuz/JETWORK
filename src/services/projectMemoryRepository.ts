import { supabase } from '../supabase';
import type { ProjectMemory } from './ai/projectMemoryEngine';

export interface ProjectMemoryWriteResult {
  ok: boolean;
  savedCount: number;
  error?: string;
}

function categoryFromKey(key: string): string {
  const prefix = key.split('.')[0];
  if (['decision', 'requirement', 'constraint', 'assumption', 'business_rule', 'term', 'preference', 'open_question'].includes(prefix)) {
    return prefix;
  }
  return 'fact';
}

export async function loadProjectMemory(workspaceId: string): Promise<ProjectMemory> {
  const { data, error } = await supabase
    .from('project_memory_entries')
    .select('memory_key,value,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: true });

  if (error) throw error;

  return (data || []).reduce<ProjectMemory>((memory, row: any) => {
    if (row.memory_key && typeof row.value === 'string') memory[row.memory_key] = row.value;
    return memory;
  }, {});
}

export async function saveProjectMemory(
  workspaceId: string,
  updates: ProjectMemory,
  sourceMessageId?: string,
): Promise<ProjectMemoryWriteResult> {
  const entries = Object.entries(updates).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) return { ok: true, savedCount: 0 };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (authError || !userId) {
    return { ok: false, savedCount: 0, error: authError?.message || 'Authenticated user is required.' };
  }

  const rows = entries.map(([memoryKey, value]) => ({
    workspace_id: workspaceId,
    owner_id: userId,
    memory_key: memoryKey,
    value: value.trim().slice(0, 2000),
    category: categoryFromKey(memoryKey),
    source_message_id: sourceMessageId || null,
  }));

  const { error } = await supabase
    .from('project_memory_entries')
    .upsert(rows, { onConflict: 'workspace_id,owner_id,memory_key' });

  if (error) return { ok: false, savedCount: 0, error: error.message };
  return { ok: true, savedCount: rows.length };
}
