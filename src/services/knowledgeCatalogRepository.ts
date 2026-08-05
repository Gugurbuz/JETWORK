import { supabase } from '../supabase';
import type { AttachmentIngestion, KnowledgeItem, MessageAttachment } from '../types';

const KNOWLEDGE_BUCKET = 'knowledge-sources';

export async function resolveKnowledgeWorkspace(
  workspaceId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('resolve_account_knowledge_workspace', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) {
    throw new Error('Hesap bilgi bankası çözümlenemedi.');
  }
  return data;
}

export interface KnowledgeIngestionResult {
  sourceId: string;
  sourceVersionId: string;
  jobId: string;
  objects: number;
  relations: number;
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
  score: number;
}

const sanitizeFileName = (fileName: string) => fileName
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 180) || 'source.txt';

const attachmentToFile = (attachment: MessageAttachment): File => {
  if (attachment.file) return attachment.file;
  if (!attachment.data) {
    throw new Error('Bilgi kaynağının dosya içeriği artık mevcut değil; dosyayı yeniden ekleyin.');
  }
  const bytes = Uint8Array.from(atob(attachment.data), character => character.charCodeAt(0));
  return new File(
    [bytes],
    attachment.name || 'source.txt',
    { type: attachment.mimeType || 'text/plain' },
  );
};

export const isKnowledgeFile = (attachment: MessageAttachment) =>
  /\.(txt|md)$/i.test(attachment.name || '')
  && ['text/plain', 'text/markdown', ''].includes(attachment.mimeType || '');

export async function ingestKnowledgeAttachment(
  workspaceId: string,
  attachment: MessageAttachment,
  onStatus?: (status: AttachmentIngestion) => void | Promise<void>,
): Promise<KnowledgeIngestionResult> {
  if (!isKnowledgeFile(attachment)) {
    throw new Error('Bilgi bankasının ilk sürümü yalnızca TXT ve MD dosyalarını destekliyor.');
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw authError || new Error('Bilgi kaynağı yüklemek için oturum gerekli.');
  }

  const knowledgeWorkspaceId = await resolveKnowledgeWorkspace(workspaceId);

  const file = attachmentToFile(attachment);
  const fileName = sanitizeFileName(file.name);
  const mimeType = fileName.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
  const storagePath = `${authData.user.id}/${knowledgeWorkspaceId}/${crypto.randomUUID()}/${fileName}`;
  await onStatus?.({ status: 'uploading' });
  const { error: uploadError } = await supabase.storage
    .from(KNOWLEDGE_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '3600',
    });
  if (uploadError) {
    await onStatus?.({ status: 'failed', error: uploadError.message });
    throw uploadError;
  }

  try {
    await onStatus?.({ status: 'processing' });
    const { data, error } = await supabase.functions.invoke('ingest-knowledge-source', {
      body: {
        workspaceId: knowledgeWorkspaceId,
        storagePath,
        fileName: file.name,
        mimeType,
      },
    });
    if (error) throw error;
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
    await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .remove([storagePath])
      .catch(() => undefined);
    await onStatus?.({
      status: 'failed',
      error: error instanceof Error ? error.message : 'Bilgi kaynağı işlenemedi.',
    });
    throw error;
  }
}

export async function listKnowledgeSources(
  workspaceId: string,
): Promise<KnowledgeSourceSummary[]> {
  const knowledgeWorkspaceId = await resolveKnowledgeWorkspace(workspaceId);
  const { data, error } = await supabase
    .from('kb_sources')
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
      kb_source_versions!kb_source_versions_source_id_fkey (
        version_number,
        object_count,
        relation_count
      )
    `)
    .eq('workspace_id', knowledgeWorkspaceId)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((row: any) => {
    const versions = Array.isArray(row.kb_source_versions)
      ? row.kb_source_versions
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
    };
  });
}

export async function publishKnowledgeSource(sourceId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_knowledge_source', {
    p_source_id: sourceId,
  });
  if (error) throw error;
}

export async function archiveKnowledgeSource(sourceId: string): Promise<void> {
  const { error } = await supabase
    .from('kb_sources')
    .update({ publication_status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', sourceId);
  if (error) throw error;
}

export async function deleteKnowledgeSource(source: KnowledgeSourceSummary): Promise<void> {
  const { error } = await supabase.from('kb_sources').delete().eq('id', source.id);
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
  const knowledgeWorkspaceId = await resolveKnowledgeWorkspace(workspaceId);
  const { data, error } = await supabase.rpc('search_knowledge_catalog', {
    p_workspace_id: knowledgeWorkspaceId,
    p_query: normalizedQuery,
    p_object_types: null,
    p_limit: limit,
  });
  if (error) throw error;

  return ((data || []) as KnowledgeCatalogSearchRow[]).map(row => ({
    id: row.object_id,
    projectId: knowledgeWorkspaceId,
    content: [
      `Kaynak: ${row.source_name}`,
      `Nesne: ${row.canonical_key}`,
      row.summary || row.title,
      row.content,
    ].filter(Boolean).join('\n').slice(0, 8_000),
    keywords: [row.object_type, row.object_name, row.canonical_key],
    importance: Math.max(1, Math.min(10, Math.round(Number(row.score || 0.5) * 10))),
    createdAt: Date.now(),
    sourceType: 'uploaded_source',
    similarity: Number(row.score || 0),
  }));
}
