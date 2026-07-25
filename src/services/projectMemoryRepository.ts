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

function confirmationStateFromKey(key: string): 'confirmed' | 'inferred_from_user' {
  const category = categoryFromKey(key);
  return ['decision', 'requirement', 'constraint', 'business_rule', 'term'].includes(category)
    ? 'confirmed'
    : 'inferred_from_user';
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
    source_type: 'user_message',
    confirmation_state: confirmationStateFromKey(memoryKey),
    confidence: confirmationStateFromKey(memoryKey) === 'confirmed' ? 1 : 0.8,
    memory_version: 1,
  }));

  let { error } = await supabase
    .from('project_memory_entries')
    .upsert(rows, { onConflict: 'workspace_id,owner_id,memory_key' });

  // Allows a safe application rollout before the Sprint 1 migration reaches
  // every environment. Once migrated, provenance columns are always written.
  if (error && /source_type|confirmation_state|confidence|memory_version/i.test(error.message)) {
    const legacyRows = rows.map(({
      source_type,
      confirmation_state,
      confidence,
      memory_version,
      ...legacy
    }) => legacy);
    const fallback = await supabase
      .from('project_memory_entries')
      .upsert(legacyRows, { onConflict: 'workspace_id,owner_id,memory_key' });
    error = fallback.error;
  }

  if (error) return { ok: false, savedCount: 0, error: error.message };
  return { ok: true, savedCount: rows.length };
}
