import type { KnowledgeItem } from '../types';
import { supabase } from '../supabase';
import { hybridSearch } from './contextManager';

type EmbeddingPurpose = 'query' | 'document';

interface WorkspaceKnowledgeRow {
  id: string;
  workspace_id: string;
  content: string;
  keywords?: string[] | null;
  importance?: number | null;
  source_type?: KnowledgeItem['sourceType'] | null;
  source_message_id?: string | null;
  created_at?: string | null;
  similarity?: number | null;
}

function rowToKnowledgeItem(row: WorkspaceKnowledgeRow): KnowledgeItem {
  return {
    id: row.id,
    content: row.content,
    keywords: row.keywords || [],
    importance: row.importance ?? 5,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    sourceType: row.source_type || undefined,
    sourceMessageId: row.source_message_id || undefined,
    similarity: row.similarity ?? undefined,
    projectId: row.workspace_id,
  };
}

async function requestEmbedding(
  text: string,
  purpose: EmbeddingPurpose,
): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl || !token) return null;

  const response = await fetch(`${supabaseUrl}/functions/v1/gemini-embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    },
    body: JSON.stringify({ text: trimmed.slice(0, 24_000), purpose }),
  });
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  const values = payload?.embedding;
  return Array.isArray(values) && values.length === 768
    ? values.map(Number)
    : null;
}

export function mergeWorkspaceKnowledgeResults(
  localKeywordResults: KnowledgeItem[],
  semanticResults: KnowledgeItem[],
  limit = 6,
): KnowledgeItem[] {
  const merged = new Map<string, { item: KnowledgeItem; score: number }>();

  localKeywordResults.forEach((item, index) => {
    const key = item.content.trim().toLocaleLowerCase('tr-TR');
    const score = 0.55 - (index * 0.03) + ((item.importance / 10) * 0.15);
    merged.set(key, { item, score });
  });

  semanticResults.forEach(item => {
    const key = item.content.trim().toLocaleLowerCase('tr-TR');
    const semanticScore = (item.similarity || 0) * 0.75 + ((item.importance / 10) * 0.1);
    const existing = merged.get(key);
    if (!existing || semanticScore > existing.score) {
      merged.set(key, { item, score: Math.max(existing?.score || 0, semanticScore) });
    }
  });

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(result => result.item);
}

export async function loadWorkspaceKnowledge(
  workspaceId: string,
  limit = 100,
): Promise<KnowledgeItem[]> {
  const { data, error } = await supabase
    .from('workspace_knowledge')
    .select('id,workspace_id,content,keywords,importance,source_type,source_message_id,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(row => rowToKnowledgeItem(row as WorkspaceKnowledgeRow));
}

export async function searchWorkspaceKnowledge(
  workspaceId: string,
  query: string,
  localKnowledge: KnowledgeItem[],
  limit = 6,
): Promise<KnowledgeItem[]> {
  const workspaceLocal = localKnowledge.filter(item => item.projectId === workspaceId);
  const keywordResults = hybridSearch(query, workspaceLocal, limit);
  const embedding = await requestEmbedding(query, 'query').catch(() => null);
  if (!embedding) return keywordResults;

  const { data, error } = await supabase.rpc('match_workspace_knowledge', {
    query_workspace_id: workspaceId,
    query_embedding: embedding,
    match_count: limit,
    similarity_threshold: 0.52,
  });
  if (error) return keywordResults;

  const semanticResults = (data || [])
    .map(row => rowToKnowledgeItem(row as WorkspaceKnowledgeRow))
    .filter(item => item.projectId === workspaceId);
  return mergeWorkspaceKnowledgeResults(keywordResults, semanticResults, limit);
}

export async function saveWorkspaceKnowledgeItems(
  workspaceId: string,
  messageId: string,
  items: KnowledgeItem[],
): Promise<number> {
  const scoped = items
    .filter(item => item.projectId === workspaceId && !!item.content.trim())
    .slice(0, 8);
  if (scoped.length === 0) return 0;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const ownerId = authData.user?.id;
  if (authError || !ownerId) throw authError || new Error('Authenticated user is required.');

  const rows = await Promise.all(scoped.map(async item => ({
    id: item.id,
    workspace_id: workspaceId,
    owner_id: ownerId,
    content: item.content.trim().slice(0, 8_000),
    keywords: item.keywords.slice(0, 32),
    importance: Math.max(1, Math.min(10, item.importance)),
    source_type: item.sourceType || 'user_message',
    source_message_id: item.sourceMessageId || messageId,
    embedding: await requestEmbedding(item.content, 'document').catch(() => null),
  })));

  const { error } = await supabase
    .from('workspace_knowledge')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return rows.length;
}
