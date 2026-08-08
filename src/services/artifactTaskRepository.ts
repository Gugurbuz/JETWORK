import { supabase } from '../supabase';
import type { AssistantDocumentRequestMode } from './assistantDocumentIntent';

export type ArtifactTaskStatus =
  | 'awaiting_input'
  | 'generating'
  | 'validating'
  | 'persisting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ArtifactTask {
  id: string;
  workspaceId: string;
  ownerId: string;
  artifactType: 'business_analysis';
  operation: 'create' | 'revise';
  status: ArtifactTaskStatus;
  requestMessageId?: string;
  requestText: string;
  artifactPayload?: Record<string, unknown>;
  documentVersionId?: string;
  documentVersionNumber?: number;
  errorMessage?: string;
}

const ACTIVE_STATUSES: ArtifactTaskStatus[] = ['awaiting_input', 'generating', 'validating', 'persisting'];
const INTERRUPTIBLE_STATUSES: ArtifactTaskStatus[] = ['generating', 'validating', 'persisting'];
export const ARTIFACT_STALE_AFTER_MS = 10 * 60 * 1000;
const MAX_ARTIFACT_SOURCE_CONTEXT = 64_000;

function mapRow(row: any): ArtifactTask {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    ownerId: String(row.owner_id),
    artifactType: 'business_analysis',
    operation: row.operation === 'revise' ? 'revise' : 'create',
    status: row.status as ArtifactTaskStatus,
    requestMessageId: row.request_message_id ? String(row.request_message_id) : undefined,
    requestText: String(row.request_text || ''),
    artifactPayload: row.artifact_payload && typeof row.artifact_payload === 'object'
      ? row.artifact_payload as Record<string, unknown>
      : undefined,
    documentVersionId: row.document_version_id ? String(row.document_version_id) : undefined,
    documentVersionNumber: row.document_version_number == null ? undefined : Number(row.document_version_number),
    errorMessage: row.error_message ? String(row.error_message) : undefined,
  };
}

export function artifactStaleBefore(now = Date.now()): string {
  return new Date(now - ARTIFACT_STALE_AFTER_MS).toISOString();
}

export function mergeArtifactRequestText(existing: string, next: string): string {
  const current = String(existing || '').trim();
  const incoming = String(next || '').trim();
  if (!current) return incoming.slice(0, MAX_ARTIFACT_SOURCE_CONTEXT);
  if (!incoming) return current.slice(0, MAX_ARTIFACT_SOURCE_CONTEXT);
  if (current.includes(incoming)) return current.slice(-MAX_ARTIFACT_SOURCE_CONTEXT);

  const merged = `${current}\n\n[SONRAKİ KULLANICI YANITI]\n${incoming}`;
  return merged.slice(-MAX_ARTIFACT_SOURCE_CONTEXT);
}

async function cancelStaleArtifactTasks(workspaceId: string): Promise<void> {
  const { error } = await supabase
    .from('artifact_tasks')
    .update({
      status: 'cancelled',
      error_message: 'Artifact işlemi oturum tamamlanmadan kesildi. Yeni talep veya tekrar deneme ile devam edilebilir.',
      last_transition_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .in('status', INTERRUPTIBLE_STATUSES)
    .lt('updated_at', artifactStaleBefore());

  if (error && String(error.code || '') !== '42P01') {
    console.warn('Stale artifact tasks could not be cancelled:', error);
  }
}

export async function getActiveArtifactTask(workspaceId: string): Promise<ArtifactTask | null> {
  await cancelStaleArtifactTasks(workspaceId);

  const { data, error } = await supabase
    .from('artifact_tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('status', ACTIVE_STATUSES)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // During a rolling deploy the migration may not exist yet. Artifact Runtime
    // degrades to the existing message-history continuation logic instead of
    // breaking chat.
    if (String(error.code || '') === '42P01' || /artifact_tasks/i.test(String(error.message || ''))) {
      return null;
    }
    throw error;
  }
  return data ? mapRow(data) : null;
}

export async function ensureArtifactTask(input: {
  workspaceId: string;
  requestMessageId?: string;
  requestText: string;
  mode: Exclude<AssistantDocumentRequestMode, 'none'>;
  status: ArtifactTaskStatus;
}): Promise<ArtifactTask | null> {
  const { data: authData } = await supabase.auth.getUser();
  const ownerId = authData.user?.id;
  if (!ownerId) return null;

  const existing = await getActiveArtifactTask(input.workspaceId);
  const operation = input.mode === 'revise' ? 'revise' : 'create';
  if (existing) {
    const { data, error } = await supabase
      .from('artifact_tasks')
      .update({
        operation,
        status: input.status,
        request_message_id: input.requestMessageId || existing.requestMessageId || null,
        request_text: mergeArtifactRequestText(existing.requestText, input.requestText),
        error_message: null,
        last_transition_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  const { data, error } = await supabase
    .from('artifact_tasks')
    .insert({
      workspace_id: input.workspaceId,
      owner_id: ownerId,
      artifact_type: 'business_analysis',
      operation,
      status: input.status,
      request_message_id: input.requestMessageId || null,
      request_text: input.requestText,
      last_transition_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function transitionArtifactTask(
  taskId: string | undefined,
  status: ArtifactTaskStatus,
  patch: {
    artifactPayload?: Record<string, unknown>;
    documentVersionId?: string;
    documentVersionNumber?: number;
    errorMessage?: string | null;
  } = {},
): Promise<void> {
  if (!taskId) return;
  const values: Record<string, unknown> = {
    status,
    last_transition_at: new Date().toISOString(),
  };
  if (patch.artifactPayload !== undefined) values.artifact_payload = patch.artifactPayload;
  if (patch.documentVersionId !== undefined) values.document_version_id = patch.documentVersionId;
  if (patch.documentVersionNumber !== undefined) values.document_version_number = patch.documentVersionNumber;
  if (patch.errorMessage !== undefined) values.error_message = patch.errorMessage;
  if (status === 'completed') values.completed_at = new Date().toISOString();

  const { error } = await supabase.from('artifact_tasks').update(values).eq('id', taskId);
  if (error && String(error.code || '') !== '42P01') throw error;
}

export function artifactModeForTask(task: ArtifactTask | null): AssistantDocumentRequestMode | undefined {
  if (!task) return undefined;
  return task.operation === 'revise' ? 'revise' : 'create';
}

export function shouldOpenAwaitingArtifactTask(input: {
  questions?: unknown[];
  text?: string;
  actionSummary?: string;
}): boolean {
  if (!Array.isArray(input.questions) || input.questions.length === 0) return false;
  const normalized = `${input.text || ''} ${input.actionSummary || ''}`
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /(?:dokuman|belge|ihtiyac analizi|is analizi|ba analiz)/.test(normalized)
    && /(?:hazir|olustur|uret|tamamla|netles)/.test(normalized);
}
