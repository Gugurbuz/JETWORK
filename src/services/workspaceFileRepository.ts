import { supabase } from '../supabase';
import type { MessageAttachment } from '../types';
import type { ArtifactRuntimeState } from './artifactAttachment';
import type { WorkspaceFileKind } from '../lib/files/fileMeta';

export type WorkspaceFileOrigin = 'generated' | 'uploaded';
export type WorkspaceFileSort = 'newest' | 'oldest' | 'name';

export interface WorkspaceFileRecord extends MessageAttachment {
  workspaceId: string;
  messageId?: string;
  origin: WorkspaceFileOrigin;
  fileKind: WorkspaceFileKind;
  artifactId?: string;
  artifactVersion?: number;
  artifactState?: ArtifactRuntimeState;
  byteSize?: number;
  sha256?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFileQuery {
  workspaceId?: string;
  origin?: WorkspaceFileOrigin | 'all';
  fileKind?: WorkspaceFileKind | 'all';
  search?: string;
  sort?: WorkspaceFileSort;
  limit?: number;
  offset?: number;
}

const rowToFile = (row: Record<string, any>): WorkspaceFileRecord => ({
  attachmentId: String(row.attachment_id || ''),
  name: String(row.name || ''),
  mimeType: String(row.mime_type || 'application/octet-stream'),
  purpose: row.origin === 'generated' ? 'tool_output' : 'chat_only',
  storageBucket: row.storage_bucket ? String(row.storage_bucket) : undefined,
  storagePath: row.storage_path ? String(row.storage_path) : undefined,
  url: '',
  workspaceId: String(row.workspace_id || ''),
  messageId: row.message_id ? String(row.message_id) : undefined,
  origin: row.origin === 'generated' ? 'generated' : 'uploaded',
  fileKind: ['spreadsheet', 'presentation', 'pdf', 'image'].includes(String(row.file_kind))
    ? row.file_kind as WorkspaceFileKind
    : 'document',
  artifactId: row.artifact_id ? String(row.artifact_id) : undefined,
  artifactVersion: Number.isFinite(Number(row.artifact_version)) ? Number(row.artifact_version) : undefined,
  artifactState: row.artifact_state || undefined,
  byteSize: Number.isFinite(Number(row.byte_size)) ? Number(row.byte_size) : undefined,
  sha256: row.sha256 ? String(row.sha256) : undefined,
  createdAt: String(row.created_at || ''),
  updatedAt: String(row.updated_at || row.created_at || ''),
});

export async function listWorkspaceFiles(query: WorkspaceFileQuery = {}): Promise<WorkspaceFileRecord[]> {
  const limit = Math.min(Math.max(query.limit || 100, 1), 200);
  const offset = Math.max(query.offset || 0, 0);
  let request = supabase
    .from('workspace_files')
    .select('workspace_id,message_id,attachment_id,name,mime_type,storage_bucket,storage_path,origin,file_kind,artifact_id,artifact_version,artifact_state,byte_size,sha256,created_at,updated_at')
    .is('deleted_at', null);

  if (query.workspaceId) request = request.eq('workspace_id', query.workspaceId);
  if (query.origin && query.origin !== 'all') request = request.eq('origin', query.origin);
  if (query.fileKind && query.fileKind !== 'all') request = request.eq('file_kind', query.fileKind);
  if (query.search?.trim()) request = request.ilike('name', `%${query.search.trim().replace(/[%_]/g, '\\$&')}%`);

  if (query.sort === 'oldest') request = request.order('created_at', { ascending: true });
  else if (query.sort === 'name') request = request.order('name', { ascending: true });
  else request = request.order('created_at', { ascending: false });

  const { data, error } = await request.range(offset, offset + limit - 1);
  if (error) throw error;
  return (data || []).map(row => rowToFile(row as Record<string, any>));
}

export async function softDeleteWorkspaceFile(file: WorkspaceFileRecord): Promise<void> {
  const { error } = await supabase
    .from('workspace_files')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('workspace_id', file.workspaceId)
    .eq('attachment_id', file.attachmentId || '');
  if (error) throw error;
}
