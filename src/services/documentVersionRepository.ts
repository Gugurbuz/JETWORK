import { supabase } from '../supabase';
import type { DocumentData } from '../types';

export type DocumentChangeSource =
  | 'AI'
  | 'MANUAL'
  | 'RESTORE'
  | 'TEMPLATE'
  | 'IMPORT'
  | 'SYSTEM';

export interface DocumentHead {
  currentVersionId: string | null;
  currentVersionNumber: number;
  content: DocumentData | null;
  contentHash: string | null;
}

export interface DocumentVersionRecord {
  id: string;
  workspaceId: string;
  documentId: string;
  content: DocumentData;
  createdAt: string;
  versionNumber: number;
  parentVersionId: string | null;
  changeSource: DocumentChangeSource;
  changeSummary: string;
  changedSections: string[];
  sourceMessageId: string | null;
  createdBy: string | null;
  provider: string | null;
  model: string | null;
  contentHash: string | null;
}

export interface CommitDocumentVersionInput {
  workspaceId: string;
  documentId?: string;
  content: DocumentData;
  expectedCurrentVersionId: string | null;
  changeSource: DocumentChangeSource;
  changeSummary: string;
  changedSections?: string[];
  sourceMessageId?: string | null;
  idempotencyKey?: string;
  provider?: string | null;
  model?: string | null;
}

export interface CommitDocumentVersionResult {
  versionId: string;
  versionNumber: number;
  parentVersionId: string | null;
  contentHash: string | null;
  createdAt: string;
  content: DocumentData;
}

export interface DocumentDraftRecord {
  workspaceId: string;
  documentId: string;
  sectionKey: 'businessAnalysis' | 'review';
  baseVersionId: string | null;
  content: string;
  updatedAt: string;
}

export class DocumentVersionConflictError extends Error {
  readonly code = 'DOCUMENT_VERSION_CONFLICT';
  readonly details?: string;

  constructor(message: string, details?: string) {
    super(message);
    this.name = 'DocumentVersionConflictError';
    this.details = details;
  }
}

function parseDocumentData(value: unknown): DocumentData | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as DocumentData;
    } catch {
      throw new Error('Doküman içeriği JSON olarak ayrıştırılamadı.');
    }
  }

  if (typeof value === 'object') {
    return value as DocumentData;
  }

  throw new Error('Doküman içeriği beklenen formatta değil.');
}

function mapVersionRow(row: Record<string, any>): DocumentVersionRecord {
  const parsedContent = parseDocumentData(row.content);
  if (!parsedContent) {
    throw new Error(`v${row.version_number ?? '?'} doküman içeriği boş.`);
  }

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    documentId: String(row.document_id),
    content: parsedContent,
    createdAt: String(row.created_at),
    versionNumber: Number(row.version_number || 0),
    parentVersionId: row.parent_version_id ? String(row.parent_version_id) : null,
    changeSource: (row.change_source || 'SYSTEM') as DocumentChangeSource,
    changeSummary: String(row.change_summary || 'Doküman güncellendi'),
    changedSections: Array.isArray(row.changed_sections) ? row.changed_sections.map(String) : [],
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    provider: row.provider ? String(row.provider) : null,
    model: row.model ? String(row.model) : null,
    contentHash: row.content_hash ? String(row.content_hash) : null,
  };
}

function normalizeSupabaseError(error: any): Error {
  const message = String(error?.message || error || 'Bilinmeyen doküman kayıt hatası');
  const details = error?.details ? String(error.details) : undefined;

  if (
    error?.code === '40001'
    || message.includes('DOCUMENT_VERSION_CONFLICT')
    || details?.includes('DOCUMENT_VERSION_CONFLICT')
  ) {
    return new DocumentVersionConflictError(
      'Belge siz düzenlerken başka bir kullanıcı veya AI tarafından güncellendi.',
      details,
    );
  }

  return new Error(details ? `${message} — ${details}` : message);
}

export async function getDocumentHead(
  workspaceId: string,
  documentId = 'main',
): Promise<DocumentHead> {
  const { data, error } = await supabase
    .from('documents')
    .select('content, current_version_id, current_version_number, content_hash')
    .eq('workspace_id', workspaceId)
    .eq('id', documentId)
    .maybeSingle();

  if (error) throw normalizeSupabaseError(error);

  return {
    currentVersionId: data?.current_version_id ? String(data.current_version_id) : null,
    currentVersionNumber: Number(data?.current_version_number || 0),
    content: parseDocumentData(data?.content),
    contentHash: data?.content_hash ? String(data.content_hash) : null,
  };
}

export async function listDocumentVersions(
  workspaceId: string,
  documentId = 'main',
  limit = 100,
): Promise<DocumentVersionRecord[]> {
  const { data, error } = await supabase
    .from('document_versions')
    .select([
      'id',
      'workspace_id',
      'document_id',
      'content',
      'created_at',
      'version_number',
      'parent_version_id',
      'change_source',
      'change_summary',
      'changed_sections',
      'source_message_id',
      'created_by',
      'provider',
      'model',
      'content_hash',
    ].join(', '))
    .eq('workspace_id', workspaceId)
    .eq('document_id', documentId)
    .order('version_number', { ascending: false })
    .limit(limit);

  if (error) throw normalizeSupabaseError(error);
  return (data || []).map((row) => mapVersionRow(row as Record<string, any>));
}

export async function commitDocumentVersion(
  input: CommitDocumentVersionInput,
): Promise<CommitDocumentVersionResult> {
  const documentId = input.documentId || 'main';
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID();

  const { data, error } = await supabase.rpc('commit_document_version_v2', {
    p_workspace_id: input.workspaceId,
    p_document_id: documentId,
    p_content: input.content,
    p_expected_current_version_id: input.expectedCurrentVersionId,
    p_change_source: input.changeSource,
    p_change_summary: input.changeSummary,
    p_changed_sections: input.changedSections || [],
    p_source_message_id: input.sourceMessageId || null,
    p_idempotency_key: idempotencyKey,
    p_provider: input.provider || null,
    p_model: input.model || null,
  });

  if (error) throw normalizeSupabaseError(error);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('Doküman sürümü kaydedildi ancak RPC sonuç döndürmedi.');
  }

  return {
    versionId: String(row.version_id),
    versionNumber: Number(row.version_number),
    parentVersionId: row.parent_version_id ? String(row.parent_version_id) : null,
    contentHash: row.content_hash ? String(row.content_hash) : null,
    createdAt: String(row.created_at),
    content: input.content,
  };
}

export async function loadDocumentDraft(input: {
  workspaceId: string;
  documentId?: string;
  sectionKey: 'businessAnalysis' | 'review';
}): Promise<DocumentDraftRecord | null> {
  const documentId = input.documentId || 'main';
  const { data, error } = await supabase
    .from('document_drafts')
    .select('workspace_id, document_id, section_key, base_version_id, content, updated_at')
    .eq('workspace_id', input.workspaceId)
    .eq('document_id', documentId)
    .eq('section_key', input.sectionKey)
    .maybeSingle();

  if (error) throw normalizeSupabaseError(error);
  if (!data) return null;

  return {
    workspaceId: String(data.workspace_id),
    documentId: String(data.document_id),
    sectionKey: data.section_key as 'businessAnalysis' | 'review',
    baseVersionId: data.base_version_id ? String(data.base_version_id) : null,
    content: String(data.content || ''),
    updatedAt: String(data.updated_at),
  };
}

export async function saveDocumentDraft(input: {
  workspaceId: string;
  documentId?: string;
  sectionKey: 'businessAnalysis' | 'review';
  baseVersionId: string | null;
  content: string;
}): Promise<void> {
  const documentId = input.documentId || 'main';
  const { error } = await supabase
    .from('document_drafts')
    .upsert({
      workspace_id: input.workspaceId,
      document_id: documentId,
      section_key: input.sectionKey,
      base_version_id: input.baseVersionId,
      content: input.content,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'workspace_id,document_id,section_key,updated_by',
    });

  if (error) throw normalizeSupabaseError(error);
}

export async function deleteDocumentDraft(input: {
  workspaceId: string;
  documentId?: string;
  sectionKey: 'businessAnalysis' | 'review';
}): Promise<void> {
  const documentId = input.documentId || 'main';
  const { error } = await supabase
    .from('document_drafts')
    .delete()
    .eq('workspace_id', input.workspaceId)
    .eq('document_id', documentId)
    .eq('section_key', input.sectionKey);

  if (error) throw normalizeSupabaseError(error);
}
