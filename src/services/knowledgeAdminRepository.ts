import { supabase } from '../supabase';
import { resolveKnowledgeSpace, type KnowledgeScope } from './knowledgeCatalogRepository';

export interface KnowledgeGraphHealth {
  objectCount: number;
  activeRelationCount: number;
  syntheticObjectCount: number;
  danglingRelationCount: number;
  openReviewCount: number;
}

export interface KnowledgeReviewItem {
  id: string;
  reviewType: 'possible_duplicate' | 'possible_conflict' | 'low_confidence_relation' | 'synthetic_endpoint' | 'source_version_candidate';
  canonicalKey?: string;
  relatedCanonicalKey?: string;
  confidence?: number;
  payload: Record<string, unknown>;
  status: 'open' | 'accepted' | 'rejected' | 'resolved';
  createdAt: string;
}

export interface KnowledgeSourceVersion {
  sourceId: string;
  sourceKey?: string;
  sourceName: string;
  sourceVersionId: string;
  versionNumber: number;
  contentHash: string;
  documentType?: string;
  parserVersion?: string;
  storagePath?: string;
  objectCount: number;
  relationCount: number;
  createdAt: string;
}

export async function getKnowledgeGraphHealth(
  workspaceId: string,
  scope: KnowledgeScope,
): Promise<KnowledgeGraphHealth> {
  const knowledgeSpaceId = await resolveKnowledgeSpace(workspaceId, scope);
  const { data, error } = await supabase
    .from('knowledge_graph_health_v3')
    .select('object_count,active_relation_count,synthetic_object_count,dangling_relation_count,open_review_count')
    .eq('knowledge_space_id', knowledgeSpaceId)
    .maybeSingle();
  if (error) throw error;
  return {
    objectCount: Number(data?.object_count || 0),
    activeRelationCount: Number(data?.active_relation_count || 0),
    syntheticObjectCount: Number(data?.synthetic_object_count || 0),
    danglingRelationCount: Number(data?.dangling_relation_count || 0),
    openReviewCount: Number(data?.open_review_count || 0),
  };
}

export async function listKnowledgeReviewItems(
  workspaceId: string,
  scope: KnowledgeScope,
  limit = 100,
): Promise<KnowledgeReviewItem[]> {
  const knowledgeSpaceId = await resolveKnowledgeSpace(workspaceId, scope);
  const { data, error } = await supabase
    .from('knowledge_review_items_v3')
    .select('id,review_type,canonical_key,related_canonical_key,confidence,payload,status,created_at')
    .eq('knowledge_space_id', knowledgeSpaceId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: String(row.id),
    reviewType: row.review_type,
    canonicalKey: row.canonical_key || undefined,
    relatedCanonicalKey: row.related_canonical_key || undefined,
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function listKnowledgeSourceVersions(
  workspaceId: string,
  scope: KnowledgeScope,
  sourceId?: string,
): Promise<KnowledgeSourceVersion[]> {
  const knowledgeSpaceId = await resolveKnowledgeSpace(workspaceId, scope);
  let query = supabase
    .from('knowledge_source_lineage_v3')
    .select('source_id,source_key,name,source_version_id,version_number,content_hash,document_type,parser_version,storage_path,object_count,relation_count,version_created_at')
    .eq('knowledge_space_id', knowledgeSpaceId)
    .order('version_created_at', { ascending: false });
  if (sourceId) query = query.eq('source_id', sourceId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row: any) => ({
    sourceId: String(row.source_id),
    sourceKey: row.source_key || undefined,
    sourceName: String(row.name || ''),
    sourceVersionId: String(row.source_version_id),
    versionNumber: Number(row.version_number || 0),
    contentHash: String(row.content_hash || ''),
    documentType: row.document_type || undefined,
    parserVersion: row.parser_version || undefined,
    storagePath: row.storage_path || undefined,
    objectCount: Number(row.object_count || 0),
    relationCount: Number(row.relation_count || 0),
    createdAt: row.version_created_at,
  }));
}
