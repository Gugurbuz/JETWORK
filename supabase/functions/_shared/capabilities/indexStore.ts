import {
  CAPABILITY_REGISTRY,
  CAPABILITY_REGISTRY_VERSION,
  type CapabilityRegistryItem,
} from './registry.ts'

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const boundedTopK = (value: number | undefined) => Math.max(1, Math.min(Math.trunc(Number(value) || 10), 12))

export interface CapabilityIndexSyncResult {
  total: number
  embedded: number
  unchanged: number
  deactivated: number
}

/**
 * Synchronizes immutable product capability metadata into pgvector. Embedding is
 * injected so this module owns persistence only; provider choice and execution
 * remain outside the index layer.
 */
export async function syncCapabilityIndex(input: {
  client: any
  embedDocuments: (semanticTexts: readonly string[]) => Promise<number[][]>
  registry?: readonly CapabilityRegistryItem[]
}): Promise<CapabilityIndexSyncResult> {
  const registry = input.registry || CAPABILITY_REGISTRY
  const ids = registry.map(item => item.id)
  const { data: existingRows, error: existingError } = await input.client
    .from('assistant_capability_index')
    .select('id,content_hash,embedding,active')
  if (existingError) throw existingError

  const existing = new Map<string, { content_hash?: string; embedding?: unknown; active?: boolean }>(
    (existingRows || []).map((row: any) => [String(row.id), row]),
  )

  const prepared = await Promise.all(registry.map(async item => ({
    item,
    contentHash: await sha256(`${CAPABILITY_REGISTRY_VERSION}\n${item.version}\n${item.semanticText}`),
  })))
  const changed = prepared.filter(({ item, contentHash }) => {
    const row = existing.get(item.id)
    return !row || row.content_hash !== contentHash || !row.embedding || row.active !== true
  })

  const embeddings = changed.length
    ? await input.embedDocuments(changed.map(entry => entry.item.semanticText))
    : []
  if (embeddings.length !== changed.length) throw new Error('Capability embedding batch size mismatch.')

  if (changed.length) {
    const rows = changed.map(({ item, contentHash }, index) => ({
      id: item.id,
      registry_version: CAPABILITY_REGISTRY_VERSION,
      capability_version: item.version,
      kind: item.kind,
      category: item.category,
      title: item.title,
      description: item.description,
      semantic_text: item.semanticText,
      tool_name: item.toolName || null,
      skill_key: item.skillKey || null,
      metadata: item.metadata,
      content_hash: contentHash,
      embedding: embeddings[index],
      active: true,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await input.client.from('assistant_capability_index').upsert(rows, { onConflict: 'id' })
    if (error) throw error
  }

  const stale = [...existing.keys()].filter(id => !ids.includes(id) && existing.get(id)?.active !== false)
  if (stale.length) {
    const { error } = await input.client
      .from('assistant_capability_index')
      .update({ active: false, updated_at: new Date().toISOString() })
      .in('id', stale)
    if (error) throw error
  }

  return {
    total: registry.length,
    embedded: changed.length,
    unchanged: registry.length - changed.length,
    deactivated: stale.length,
  }
}

export async function matchIndexedCapabilities(input: {
  client: any
  queryEmbedding: number[]
  topK?: number
  excludeIds?: readonly string[]
}) {
  const { data, error } = await input.client.rpc('match_assistant_capabilities', {
    p_query_embedding: input.queryEmbedding,
    p_match_count: boundedTopK(input.topK),
    p_exclude_ids: [...(input.excludeIds || [])],
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
