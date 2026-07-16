import { supabase } from '../supabase';
import type { DocumentData } from '../types';

export interface DocumentShare {
  id: string;
  token: string;
  expiresAt: string;
}

export interface SharedAnalysisPayload {
  shareId: string;
  workspaceId: string;
  data: DocumentData;
  expiresAt: string;
}

function createOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createDocumentShare(
  workspaceId: string,
  ownerId: string,
  data: DocumentData,
  lifetimeHours = 168,
): Promise<DocumentShare> {
  const token = createOpaqueToken();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + lifetimeHours * 60 * 60 * 1000).toISOString();
  const tokenHash = await sha256(token);

  const { error } = await supabase.from('shared_analyses').insert({
    id,
    workspace_id: workspaceId,
    owner_id: ownerId,
    token_hash: tokenHash,
    data,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return { id, token, expiresAt };
}

export async function loadSharedAnalysis(token: string): Promise<SharedAnalysisPayload | null> {
  const { data, error } = await supabase.rpc('get_shared_analysis', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.data) return null;
  return {
    shareId: row.share_id,
    workspaceId: row.workspace_id,
    data: row.data as DocumentData,
    expiresAt: row.expires_at,
  };
}

export async function revokeDocumentShare(shareId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_analyses')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) throw error;
}
