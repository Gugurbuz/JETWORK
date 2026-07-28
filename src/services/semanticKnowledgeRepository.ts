import { supabase } from '../supabase';
import type { KnowledgeItem } from '../types';
import { hybridSearch } from './contextManager';

async function createEmbeddings(
  texts: string[],
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT',
): Promise<number[][]> {
  return Promise.all(texts.slice(0, 20).map(async (text) => {
    const { data, error } = await supabase.functions.invoke('gemini-embed', {
      body: {
        text,
        purpose: taskType === 'RETRIEVAL_DOCUMENT' ? 'document' : 'query',
      },
    });
    if (error) throw error;
    if (!Array.isArray(data?.embedding) || data.embedding.length !== 768) {
      throw new Error('Embedding response is invalid.');
    }
    return data.embedding as number[];
  }));
}

export async function saveKnowledgeItems(
  workspaceId: string,
  items: KnowledgeItem[],
  sourceMessageId?: string,
): Promise<void> {
  if (!items.length) return;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw authError || new Error('Authenticated user is required.');

  const embeddings = await createEmbeddings(
    items.map(item => item.content),
    'RETRIEVAL_DOCUMENT',
  );
  const rows = items.flatMap((item, index) => {
    const embedding = embeddings[index];
    if (!embedding?.length) return [];
    return [{
      id: item.id,
      workspace_id: workspaceId,
      owner_id: authData.user.id,
      content: item.content,
      keywords: item.keywords,
      importance: Math.min(10, Math.max(1, Math.round(item.importance))),
      source_type: 'user_message',
      source_message_id: sourceMessageId || null,
      embedding,
    }];
  });
  if (!rows.length) return;

  const { error } = await supabase.from('workspace_knowledge').insert(rows);
  if (error) throw error;
}

async function semanticSearch(
  query: string,
  workspaceId: string,
  limit: number,
): Promise<KnowledgeItem[]> {
  const [queryEmbedding] = await createEmbeddings([query], 'RETRIEVAL_QUERY');
  if (!queryEmbedding?.length) return [];

  const { data, error } = await supabase.rpc('match_workspace_knowledge', {
    query_workspace_id: workspaceId,
    query_embedding: queryEmbedding,
    match_count: limit,
    similarity_threshold: 0.52,
  });
  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    content: row.content,
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    importance: Number(row.importance || Math.round((row.similarity || 0.5) * 10)),
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    projectId: row.workspace_id || workspaceId,
  }));
}

export async function retrieveRelevantKnowledge(
  query: string,
  localKnowledge: KnowledgeItem[],
  workspaceId: string,
  limit = 5,
): Promise<KnowledgeItem[]> {
  const lexical = hybridSearch(query, localKnowledge, limit);
  let semantic: KnowledgeItem[] = [];
  try {
    semantic = await semanticSearch(query, workspaceId, limit);
  } catch (error) {
    console.warn('Semantic knowledge retrieval failed; lexical fallback is active.', error);
  }

  const merged = new Map<string, KnowledgeItem>();
  [...semantic, ...lexical].forEach(item => {
    const key = item.id || item.content.toLocaleLowerCase('tr-TR');
    if (!merged.has(key)) merged.set(key, item);
  });
  return [...merged.values()]
    .sort((left, right) => right.importance - left.importance)
    .slice(0, limit);
}
