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
const FACT_PACKET_START = '[JETWORK_ARTIFACT_FACT_PACKET]';
const FACT_PACKET_END = '[END_JETWORK_ARTIFACT_FACT_PACKET]';
const FACT_PACKET_PATTERN = /\n?\[JETWORK_ARTIFACT_FACT_PACKET\][\s\S]*?\[END_JETWORK_ARTIFACT_FACT_PACKET\]\s*/gi;

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

const stripArtifactFactPacket = (value: string) => String(value || '').replace(FACT_PACKET_PATTERN, '\n').replace(/\n{3,}/g, '\n\n').trim();

const explicitUserDecisions = (value: string) => value
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => /^(?:\*\*)?(?:cevap|karar|kabul|seçim|secim)(?:\*\*)?\s*:/iu.test(line))
  .slice(-16);

export function buildArtifactFactPacket(input: {
  requestText: string;
  verifiedFactRefs?: string[];
}): string {
  const raw = stripArtifactFactPacket(input.requestText).slice(-48_000);
  const decisions = explicitUserDecisions(raw);
  const refs = [...new Set((input.verifiedFactRefs || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 20);
  return [
    FACT_PACKET_START,
    'policy=Only USER_REQUEST/USER_DECISIONS and VERIFIED_KNOWLEDGE_REFS are factual inputs. Previous assistant prose is not evidence. Unsupported technical details must remain [AÇIK KONU] or an explicitly accepted [VARSAYIM].',
    '[USER_REQUEST]',
    raw,
    '[END_USER_REQUEST]',
    '[USER_DECISIONS]',
    decisions.length ? decisions.join('\n') : '(none)',
    '[END_USER_DECISIONS]',
    '[VERIFIED_KNOWLEDGE_REFS]',
    refs.length ? refs.join('\n') : '(none)',
    '[END_VERIFIED_KNOWLEDGE_REFS]',
    '[OPEN_QUESTIONS]',
    '(derive only from missing information; do not invent answers)',
    '[END_OPEN_QUESTIONS]',
    FACT_PACKET_END,
  ].join('\n');
}

async function verifiedFactRefsForWorkspace(workspaceId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_assistant_verified_fact_memory', {
    p_workspace_id: workspaceId,
    p_limit: 20,
  });
  if (error) {
    // Rolling deploy compatibility: artifact generation must continue before the
    // verified-memory migration reaches production.
    if (String(error.code || '') === '42883' || /get_assistant_verified_fact_memory/i.test(String(error.message || ''))) return [];
    console.warn('Verified artifact fact memory could not be loaded:', error);
    return [];
  }
  return (Array.isArray(data) ? data : [])
    .map((row: any) => String(row?.canonical_key || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function mergeArtifactRequestText(existing: string, next: string): string {
  const current = stripArtifactFactPacket(existing);
  const incoming = stripArtifactFactPacket(next);
  if (!current) return incoming.slice(0, MAX_ARTIFACT_SOURCE_CONTEXT);
  if (!incoming) return current.slice(0, MAX_ARTIFACT_SOURCE_CONTEXT);
  if (current.includes(incoming)) return current.slice(-MAX_ARTIFACT_SOURCE_CONTEXT);
  return `${current}\n\n[SONRAKİ KULLANICI YANITI]\n${incoming}`.slice(-MAX_ARTIFACT_SOURCE_CONTEXT);
}

async function sourceTextWithFactPacket(workspaceId: string, raw: string) {
  const refs = await verifiedFactRefsForWorkspace(workspaceId);
  const source = stripArtifactFactPacket(raw);
  const packet = buildArtifactFactPacket({ requestText: source, verifiedFactRefs: refs });
  const maxSource = Math.max(1_000, MAX_ARTIFACT_SOURCE_CONTEXT - packet.length - 2);
  return `${source.slice(-maxSource)}\n\n${packet}`.slice(-MAX_ARTIFACT_SOURCE_CONTEXT);
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

  if (error && String(error.code || '') !== '42P01') console.warn('Stale artifact tasks could not be cancelled:', error);
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
    if (String(error.code || '') === '42P01' || /artifact_tasks/i.test(String(error.message || ''))) return null;
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
    const merged = mergeArtifactRequestText(existing.requestText, input.requestText);
    const requestText = await sourceTextWithFactPacket(input.workspaceId, merged);
    const { data, error } = await supabase
      .from('artifact_tasks')
      .update({
        operation,
        status: input.status,
        request_message_id: input.requestMessageId || existing.requestMessageId || null,
        request_text: requestText,
        error_message: null,
        last_transition_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  const requestText = await sourceTextWithFactPacket(input.workspaceId, input.requestText);
  const { data, error } = await supabase
    .from('artifact_tasks')
    .insert({
      workspace_id: input.workspaceId,
      owner_id: ownerId,
      artifact_type: 'business_analysis',
      operation,
      status: input.status,
      request_message_id: input.requestMessageId || null,
      request_text: requestText,
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
  const values: Record<string, unknown> = { status, last_transition_at: new Date().toISOString() };
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