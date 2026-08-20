import { supabase } from '../supabase';
import type { AttachmentIngestion, KnowledgeItem, MessageAttachment } from '../types';
import {
  toKnowledgeFunctionOperationError,
  toKnowledgeOperationError,
} from './knowledgeUploadErrors';

const KNOWLEDGE_BUCKET = 'knowledge-sources';

export type KnowledgeScope = 'global' | 'project';

export interface KnowledgeContext {
  globalSpaceId: string;
  projectSpaceId?: string;
  projectId?: string;
}

export interface KnowledgeIngestionResult {
  sourceId: string;
  sourceVersionId: string;
  jobId: string;
  objects: number;
  relations: number;
  chunkCount?: number;
  extractionMethod?: string;
  embeddingStats?: {
    attempted: number;
    embedded: number;
    skipped: number;
    maxChunks: number;
  };
  parsedObjects: number;
  parsedRelations: number;
  deduplicated: boolean;
  publicationStatus: 'draft' | 'published' | 'archived';
  warnings: string[];
}

export interface KnowledgeSourceSummary {
  id: string;
  name: string;
  mediaType: string;
  publicationStatus: 'draft' | 'published' | 'archived';
  ingestionStatus: 'pending' | 'processing' | 'ready' | 'failed';
  latestVersion: number;
  documentType?: string;
  createdAt: string;
  updatedAt: string;
  objectCount: number;
  relationCount: number;
  storagePath?: string;
  scope: KnowledgeScope;
}

interface KnowledgeCatalogSearchRow {
  object_id: string;
  canonical_key: string;
  object_type: string;
  object_name: string;
  title: string;
  summary?: string | null;
  content: string;
  source_id: string;
  source_name: string;
  scope_type: KnowledgeScope;
  score: number;
}

const sanitizeFileName = (fileName: string) => fileName
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 180) || 'source.txt';

const KNOWLEDGE_FILE_EXTENSIONS = /\.(txt|md|csv|tsv|html?|json|xml|svg|pdf|docx|pptx|xlsx)$/i;

const KNOWLEDGE_MIME_TYPES = new Set([
  '',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/html',
  'application/json',
  'application/xml',
  'image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const inferKnowledgeMimeType = (file: File, fileName: string) => {
  if (file.type && KNOWLEDGE_MIME_TYPES.has(file.type)) return file.type;
  const lower = fileName.toLocaleLowerCase('en-US');
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.tsv')) return 'text/tab-separated-values';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.xml')) return 'application/xml';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'text/plain';
};

const attachmentToFile = (attachment: MessageAttachment): File => {
  if (attachment.file) return attachment.file;
  if (!attachment.data) {
    throw new Error('Bilgi kaynağının dosya içeriği artık mevcut değil; dosyayı yeniden ekleyin.');
  }
  const bytes = Uint8Array.from(atob(attachment.data), character => character.charCodeAt(0));
  return new File([bytes], attachment.name || 'source.txt', {
    type: attachment.mimeType || 'text/plain',
  });
};

export const isKnowledgeFile = (attachment: Pick<MessageAttachment, 'name' | 'mimeType'>) =>
  KNOWLEDGE_FILE_EXTENSIONS.test(attachment.name || '')
  && (KNOWLEDGE_MIME_TYPES.has(attachment.mimeType || '') || attachment.mimeType === 'application/octet-stream');

export async function resolveKnowledgeContext(workspaceId: string): Promise<KnowledgeContext> {
  const { data, error } = await supabase.rpc('resolve_knowledge_context', {
    p_workspace_id: workspaceId,
  });
  if (error) throw toKnowledgeOperationError(error, 'Bilgi bankası kapsamı hazırlanırken');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.global_space_id) {
    throw new Error('JetWork Bilgi Bankası çözümlenemedi.');
  }
  return {
    globalSpaceId: String(row.global_space_id),
    projectSpaceId: row.project_space_id ? String(row.project_space_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
  };
}

export async function resolveKnowledgeSpace(
  workspaceId: string,
  scope: KnowledgeScope,
): Promise<string> {
  const { data, error } = await supabase.rpc('resolve_knowledge_space_v2', {
    p_workspace_id: workspaceId,
    p_scope_type: scope,
  });
  if (error) throw toKnowledgeOperationError(error, 'Bilgi bankası kapsamı hazırlanırken');
  if (typeof data !== 'string' || !data) {
    throw new Error(scope === 'global' ? 'JetWork Bilgi Bankası bulunamadı.' : 'Proje Bilgi Bankası bulunamadı.');
  }
  return data;
}

export async function ingestKnowledgeFile(
  workspaceId: string,
  file: File,
  scope: KnowledgeScope = 'global',
  onStatus?: (status: AttachmentIngestion) => void | Promise<void>,
): Promise<KnowledgeIngestionResult> {
  if (!KNOWLEDGE_FILE_EXTENSIONS.test(file.name)) {
    throw new Error('Bilgi bankası TXT, MD, CSV, HTML, JSON, PDF, DOCX, PPTX ve XLSX dosyalarını destekliyor.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (sessionError || !user) {
    throw sessionError
      ? toKnowledgeOperationError(sessionError, 'Bilgi kaynağı yükleme oturumu hazırlanırken')
      : new Error('Bilgi kaynağı yüklemek için oturum gerekli.');
  }

  let knowledgeSpaceId: string;
  try {
    knowledgeSpaceId = await resolveKnowledgeSpace(workspaceId, scope);
  } catch (error) {
    throw toKnowledgeOperationError(error, 'Bilgi bankası kapsamı hazırlanırken');
  }

  const fileName = sanitizeFileName(file.name);
  const mimeType = inferKnowledgeMimeType(file, fileName);
  const storagePath = `${user.id}/${knowledgeSpaceId}/${crypto.randomUUID()}/${fileName}`;

  await onStatus?.({ status: 'uploading' });
  const { error: uploadError } = await supabase.storage
    .from(KNOWLEDGE_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '3600',
    });
  if (uploadError) {
    const normalizedError = toKnowledgeOperationError(uploadError, 'Bilgi kaynağı dosyası yüklenirken');
    await onStatus?.({ status: 'failed', error: normalizedError.message });
    throw normalizedError;
  }

  try {
    await onStatus?.({ status: 'processing' });
    const { data, error } = await supabase.functions.invoke('ingest-knowledge-source', {
      body: {
        knowledgeSpaceId,
        storagePath,
        fileName: file.name,
        mimeType,
      },
    });
    if (error) throw await toKnowledgeFunctionOperationError(error, 'Bilgi kaynağı işlenirken');
    if (!data?.sourceId) throw new Error(data?.error || 'Bilgi kaynağı işlenemedi.');
    const result = data as KnowledgeIngestionResult;
    await onStatus?.({
      status: 'ready',
      sourceId: result.sourceId,
      jobId: result.jobId,
      publicationStatus: result.publicationStatus,
      objectCount: result.parsedObjects,
      relationCount: result.parsedRelations,
    });
    return result;
  } catch (error) {
    await supabase.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]).catch(() => undefined);
    const normalizedError = toKnowledgeOperationError(error, 'Bilgi kaynağı işlenirken');
    await onStatus?.({
      status: 'failed',
      error: normalizedError.message,
    });
    throw normalizedError;
  }
}

export async function ingestKnowledgeAttachment(
  workspaceId: string,
  attachment: MessageAttachment,
  onStatus?: (status: AttachmentIngestion) => void | Promise<void>,
): Promise<KnowledgeIngestionResult> {
  if (!isKnowledgeFile(attachment)) {
    throw new Error('Bilgi bankası TXT, MD, CSV, HTML, JSON, PDF, DOCX, PPTX ve XLSX dosyalarını destekliyor.');
  }
  return ingestKnowledgeFile(workspaceId, attachmentToFile(attachment), 'global', onStatus);
}

export async function listKnowledgeSources(
  workspaceId: string,
  scope: KnowledgeScope = 'global',
): Promise<KnowledgeSourceSummary[]> {
  const knowledgeSpaceId = await resolveKnowledgeSpace(workspaceId, scope);
  const { data, error } = await supabase
    .from('knowledge_sources_v2')
    .select(`
      id,
      name,
      media_type,
      publication_status,
      ingestion_status,
      latest_version,
      metadata,
      created_at,
      updated_at,
      storage_path,
      knowledge_source_versions_v2!knowledge_source_versions_v2_source_id_fkey (
        version_number,
        object_count,
        relation_count
      )
    `)
    .eq('knowledge_space_id', knowledgeSpaceId)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((row: any) => {
    const versions = Array.isArray(row.knowledge_source_versions_v2)
      ? row.knowledge_source_versions_v2
      : [];
    const latest = versions.find((version: any) =>
      Number(version.version_number) === Number(row.latest_version));
    return {
      id: row.id,
      name: row.name,
      mediaType: row.media_type,
      publicationStatus: row.publication_status,
      ingestionStatus: row.ingestion_status,
      latestVersion: Number(row.latest_version || 0),
      documentType: row.metadata?.documentType,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      objectCount: Number(latest?.object_count || 0),
      relationCount: Number(latest?.relation_count || 0),
      storagePath: row.storage_path || undefined,
      scope,
    };
  });
}

export async function publishKnowledgeSource(sourceId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_knowledge_source_v2', {
    p_source_id: sourceId,
  });
  if (error) throw error;
}

export async function archiveKnowledgeSource(sourceId: string): Promise<void> {
  const { error } = await supabase
    .from('knowledge_sources_v2')
    .update({ publication_status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', sourceId);
  if (error) throw error;
}

export async function deleteKnowledgeSource(source: KnowledgeSourceSummary): Promise<void> {
  const { error } = await supabase.from('knowledge_sources_v2').delete().eq('id', source.id);
  if (error) throw error;
  if (source.storagePath) {
    const { error: storageError } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .remove([source.storagePath]);
    if (storageError) console.warn('Knowledge source file could not be removed:', storageError);
  }
}

export async function searchKnowledgeCatalog(
  workspaceId: string,
  query: string,
  limit = 6,
): Promise<KnowledgeItem[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];
  const { data, error } = await supabase.rpc('search_knowledge_catalog_v2', {
    p_workspace_id: workspaceId,
    p_query: normalizedQuery,
    p_object_types: null,
    p_limit: limit,
  });
  if (error) throw error;

  return ((data || []) as KnowledgeCatalogSearchRow[]).map(row => ({
    id: row.object_id,
    projectId: row.scope_type,
    content: [
      `Kapsam: ${row.scope_type === 'project' ? 'Proje' : 'JetWork Global'}`,
      `Kaynak: ${row.source_name}`,
      `Nesne: ${row.canonical_key}`,
      row.summary || row.title,
      row.content,
    ].filter(Boolean).join('\n').slice(0, 8_000),
    keywords: [row.scope_type, row.object_type, row.object_name, row.canonical_key],
    importance: Math.max(1, Math.min(10, Math.round(Number(row.score || 0.5) * 10))),
    createdAt: Date.now(),
    sourceType: 'uploaded_source',
    similarity: Number(row.score || 0),
  }));
}
