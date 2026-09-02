import { embedCapabilityQuery } from './embeddings.ts'
import { matchIndexedCapabilities } from './indexStore.ts'
import { discoverCapabilityCandidates, type CapabilityCandidate } from './discovery.ts'
import { capabilityById, CAPABILITY_REGISTRY_VERSION } from './registry.ts'

export interface IndexedCapabilityDiscoveryResult {
  candidates: CapabilityCandidate[]
  mode: 'embedding_index' | 'lexical_fallback'
  fallbackReason?: string
}

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)
const metadataStrings = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map(item => clean(item, 300)).filter(Boolean))]
  : undefined

export async function discoverIndexedCapabilities(input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
  excludeIds?: readonly string[]
}): Promise<IndexedCapabilityDiscoveryResult> {
  const query = clean(input.query, 2_000)
  if (!query) return { candidates: [], mode: 'lexical_fallback', fallbackReason: 'empty_query' }

  if (!input.geminiApiKey) {
    return {
      candidates: discoverCapabilityCandidates({ query, topK: input.topK, excludeIds: input.excludeIds }),
      mode: 'lexical_fallback',
      fallbackReason: 'embedding_provider_unavailable',
    }
  }

  try {
    const queryEmbedding = await embedCapabilityQuery(input.geminiApiKey, query)
    const rows = await matchIndexedCapabilities({
      client: input.client,
      queryEmbedding,
      topK: input.topK,
      excludeIds: input.excludeIds,
    })
    const candidates: CapabilityCandidate[] = rows.map((row: any) => {
      const id = clean(row.id, 300)
      const registryItem = capabilityById(id)
      const metadata = row?.metadata && typeof row.metadata === 'object'
        ? row.metadata as Record<string, unknown>
        : registryItem?.metadata || {}
      return {
        id,
        kind: row.kind,
        category: row.category,
        title: clean(row.title, 500),
        description: clean(row.description, 2_000),
        toolName: clean(row.tool_name, 300) || registryItem?.toolName || undefined,
        skillKey: clean(row.skill_key, 300) || registryItem?.skillKey || undefined,
        declaredTools: metadataStrings(metadata.declaredTools || registryItem?.metadata?.declaredTools),
        executorTools: metadataStrings(metadata.executorTools || registryItem?.metadata?.executorTools),
        score: Number(Number(row.similarity || 0).toFixed(6)),
        semanticScore: Number(Number(row.similarity || 0).toFixed(6)),
        lexicalScore: 0,
        registryVersion: clean(row.registry_version, 120) || CAPABILITY_REGISTRY_VERSION,
        discoveryVersion: 'capability-discovery-v2',
      }
    })
    if (candidates.length) return { candidates, mode: 'embedding_index' }
    return {
      candidates: discoverCapabilityCandidates({ query, topK: input.topK, excludeIds: input.excludeIds }),
      mode: 'lexical_fallback',
      fallbackReason: 'embedding_index_empty',
    }
  } catch (error) {
    return {
      candidates: discoverCapabilityCandidates({ query, topK: input.topK, excludeIds: input.excludeIds }),
      mode: 'lexical_fallback',
      fallbackReason: error instanceof Error ? clean(error.message, 500) : 'embedding_index_failed',
    }
  }
}
