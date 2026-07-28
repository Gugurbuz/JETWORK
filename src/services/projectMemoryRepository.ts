import { supabase } from '../supabase';
import type { ProjectMemory } from './ai/projectMemoryEngine';
import type {
  ProjectMemoryConfirmationStatus,
  ProjectMemoryItem,
  ProjectMemoryItemType,
  ProjectMemorySourceType,
} from '../types';

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

const typeFromCategory = (category = 'fact'): ProjectMemoryItemType => {
  const mapping: Record<string, ProjectMemoryItemType> = {
    fact: 'FACT',
    decision: 'DECISION',
    requirement: 'REQUIREMENT',
    constraint: 'CONSTRAINT',
    assumption: 'ASSUMPTION',
    business_rule: 'BUSINESS_RULE',
    term: 'TERM',
    preference: 'PREFERENCE',
    open_question: 'OPEN_QUESTION',
  };
  return mapping[category] || 'FACT';
};

function parseStructuredValue(row: any): ProjectMemoryItem | null {
  try {
    const value = JSON.parse(row.value);
    if (
      value
      && typeof value === 'object'
      && typeof value.id === 'string'
      && typeof value.key === 'string'
      && typeof value.value === 'string'
      && typeof value.sourceType === 'string'
      && typeof value.confirmationStatus === 'string'
    ) {
      return {
        ...(value as ProjectMemoryItem),
        version: Number(row.memory_version || value.version || 1),
        supersedes: row.supersedes_id || value.supersedes || undefined,
        validFrom: row.valid_from || value.validFrom,
      };
    }
  } catch {
    // Existing rows are plain text and are mapped as legacy memory below.
  }
  return null;
}

const sourceTypeFromDatabase = (sourceType?: string): ProjectMemorySourceType => {
  const mapping: Record<string, ProjectMemorySourceType> = {
    user_message: 'USER',
    document: 'DOCUMENT',
    system: 'SYSTEM',
    ai_inference: 'AI_INFERENCE',
    inferred_from_user: 'AI_INFERENCE',
    legacy_unknown: 'LEGACY',
  };
  return mapping[sourceType || ''] || 'LEGACY';
};

const sourceTypeToDatabase = (sourceType: ProjectMemorySourceType): string => {
  const mapping: Record<ProjectMemorySourceType, string> = {
    USER: 'user_message',
    DOCUMENT: 'document',
    SYSTEM: 'system',
    AI_INFERENCE: 'ai_inference',
    LEGACY: 'legacy_unknown',
  };
  return mapping[sourceType];
};

const confirmationFromDatabase = (
  confirmationState?: string,
  sourceType?: string,
): ProjectMemoryConfirmationStatus => {
  if (confirmationState === 'confirmed') return 'CONFIRMED';
  if (confirmationState === 'rejected') return 'REJECTED';
  if (confirmationState === 'proposed' || confirmationState === 'unverified') return 'PROPOSED';
  return sourceType === 'user_message' ? 'CONFIRMED' : 'PROPOSED';
};

const confirmationToDatabase = (status: ProjectMemoryConfirmationStatus): string => {
  const mapping: Record<ProjectMemoryConfirmationStatus, string> = {
    CONFIRMED: 'confirmed',
    PROPOSED: 'proposed',
    REJECTED: 'rejected',
  };
  return mapping[status];
};

function rowToMemoryItem(row: any): ProjectMemoryItem {
  const structured = parseStructuredValue(row);
  if (structured) return structured;

  return {
    id: row.id,
    key: row.memory_key,
    type: typeFromCategory(row.category),
    value: row.value,
    sourceType: sourceTypeFromDatabase(row.source_type),
    sourceId: row.source_message_id || row.id,
    confirmationStatus: confirmationFromDatabase(row.confirmation_state, row.source_type),
    confidence: Number(row.confidence ?? 0.5),
    validFrom: row.valid_from || row.created_at || row.updated_at || new Date(0).toISOString(),
    version: Number(row.memory_version || 1),
    ...(row.supersedes_id ? { supersedes: row.supersedes_id } : {}),
  };
}

export async function loadProjectMemory(workspaceId: string): Promise<ProjectMemory> {
  const { data, error } = await supabase
    .from('project_memory_entries')
    .select('id,memory_key,value,category,source_message_id,source_type,confirmation_state,confidence,memory_version,supersedes_id,valid_from,created_at,updated_at')
    .eq('workspace_id', workspaceId)
    .order('valid_from', { ascending: true });

  if (error) throw error;

  return (data || []).reduce<ProjectMemory>((memory, row: any) => {
    const item = rowToMemoryItem(row);
    if (item.key && item.confirmationStatus !== 'REJECTED') {
      memory[item.key] = item.value;
    }
    return memory;
  }, {});
}

export async function loadProjectMemoryItems(workspaceId: string): Promise<ProjectMemoryItem[]> {
  const { data, error } = await supabase
    .from('project_memory_entries')
    .select('id,memory_key,value,category,source_message_id,source_type,confirmation_state,confidence,memory_version,supersedes_id,valid_from,created_at,updated_at')
    .eq('workspace_id', workspaceId)
    .order('valid_from', { ascending: true });

  if (error) throw error;

  return (data || []).map(rowToMemoryItem);
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

  const keys = entries.map(([memoryKey]) => memoryKey);
  const { data: existingRows, error: existingError } = await supabase
    .from('project_memory_entries')
    .select('id,memory_key,memory_version,valid_from,created_at')
    .eq('workspace_id', workspaceId)
    .in('memory_key', keys)
    .order('valid_from', { ascending: false });
  if (existingError) return { ok: false, savedCount: 0, error: existingError.message };

  const previousByKey = new Map<string, any>();
  (existingRows || []).forEach((row: any) => {
    if (!previousByKey.has(row.memory_key)) previousByKey.set(row.memory_key, row);
  });
  const validFrom = new Date().toISOString();
  const rows = entries.map(([memoryKey, value]) => {
    const previous = previousByKey.get(memoryKey);
    return {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      owner_id: userId,
      memory_key: memoryKey,
      value: value.trim().slice(0, 2000),
      category: categoryFromKey(memoryKey),
      source_message_id: sourceMessageId || null,
      source_type: 'user_message',
      confirmation_state: 'confirmed',
      confidence: 1,
      memory_version: Number(previous?.memory_version || 0) + 1,
      supersedes_id: previous?.id || null,
      valid_from: validFrom,
    };
  });

  const { error } = await supabase.from('project_memory_entries').insert(rows);

  if (error) return { ok: false, savedCount: 0, error: error.message };
  return { ok: true, savedCount: rows.length };
}

export async function saveProjectMemoryItems(
  workspaceId: string,
  items: ProjectMemoryItem[],
): Promise<ProjectMemoryWriteResult> {
  if (!items.length) return { ok: true, savedCount: 0 };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const userId = authData.user?.id;
  if (authError || !userId) {
    return { ok: false, savedCount: 0, error: authError?.message || 'Authenticated user is required.' };
  }

  const supersedesIds = items.flatMap(item => item.supersedes ? [item.supersedes] : []);
  const previousVersions = new Map<string, number>();
  if (supersedesIds.length) {
    const { data: previousRows, error: previousError } = await supabase
      .from('project_memory_entries')
      .select('id,memory_version')
      .in('id', supersedesIds);
    if (previousError) return { ok: false, savedCount: 0, error: previousError.message };
    (previousRows || []).forEach((row: any) => {
      previousVersions.set(row.id, Number(row.memory_version || 1));
    });
  }

  const rows = items.map(item => ({
    id: item.id,
    workspace_id: workspaceId,
    owner_id: userId,
    memory_key: item.key,
    value: item.value.trim().slice(0, 2000),
    category: item.type.toLowerCase(),
    source_message_id: item.sourceId || null,
    source_type: sourceTypeToDatabase(item.sourceType),
    confirmation_state: confirmationToDatabase(item.confirmationStatus),
    confidence: Math.min(1, Math.max(0, item.confidence)),
    memory_version: item.version || (
      item.supersedes ? (previousVersions.get(item.supersedes) || 0) + 1 : 1
    ),
    supersedes_id: item.supersedes || null,
    valid_from: item.validFrom,
  }));
  const { error } = await supabase
    .from('project_memory_entries')
    .upsert(rows, { onConflict: 'id' });

  if (error) return { ok: false, savedCount: 0, error: error.message };
  return { ok: true, savedCount: rows.length };
}
