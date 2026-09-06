import { embedCapabilityQuery } from './embeddings.ts'
import { matchIndexedCapabilities } from './indexStore.ts'
import { discoverCapabilityCandidates, type CapabilityCandidate } from './discovery.ts'
import { capabilityById, CAPABILITY_REGISTRY_VERSION } from './registry.ts'

export interface IndexedCapabilityDiscoveryResult {
  candidates: CapabilityCandidate[]
  mode: 'embedding_index' | 'lexical_fallback'
  fallbackReason?: string
}

const DISCOVERY_CACHE_TTL_MS = 120_000
const DISCOVERY_FALLBACK_CACHE_TTL_MS = 10_000
const DISCOVERY_CACHE_MAX = 64
const FOUNDATIONAL_SURFACE_VERSION = 'foundational-evidence-surface-v1'

// P1/P2 invariant: semantic Top-K narrows specialist candidates, but it must not
// remove the controller's basic evidence domains. These entries are capability
// options only; they do not choose or execute a tool. Keeping them available
// prevents an embedding miss from becoming a hidden semantic gate (for example,
// a current public-information request losing web access because provider:web_search
// ranked 11th).
const FOUNDATIONAL_CAPABILITY_IDS = [
  'provider:web_search',
  'tool:search_knowledge_catalog',
  'tool:list_knowledge_catalog',
  'tool:get_knowledge_object',
  'tool:get_knowledge_objects',
  'tool:get_related_objects',
] as const

interface DiscoveryCacheEntry {
  expiresAt: number
  promise: Promise<IndexedCapabilityDiscoveryResult>
}

const discoveryCache = new Map<string, DiscoveryCacheEntry>()

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)
const metadataStrings = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map(item => clean(item, 300)).filter(Boolean))]
  : undefined

const foundationalCandidate = (id: string): CapabilityCandidate | null => {
  const item = capabilityById(id)
  if (!item) return null
  return {
    id: item.id,
    kind: item.kind,
    category: item.category,
    title: item.title,
    description: item.description,
    toolName: item.toolName,
    skillKey: item.skillKey,
    declaredTools: metadataStrings(item.metadata?.declaredTools),
    executorTools: metadataStrings(item.metadata?.executorTools),
    // Foundation membership is not a relevance score. Zero keeps ranked Top-K
    // ordering truthful while still exposing the capability to the controller.
    score: 0,
    semanticScore: null,
    lexicalScore: 0,
    registryVersion: CAPABILITY_REGISTRY_VERSION,
    discoveryVersion: 'capability-discovery-v2',
  }
}

const withFoundationalCapabilities = (
  candidates: CapabilityCandidate[],
  excludeIds?: readonly string[],
): CapabilityCandidate[] => {
  const excluded = new Set(excludeIds || [])
  const seen = new Set(candidates.map(candidate => candidate.id))
  const merged = [...candidates]
  for (const id of FOUNDATIONAL_CAPABILITY_IDS) {
    if (excluded.has(id) || seen.has(id)) continue
    const candidate = foundationalCandidate(id)
    if (!candidate) continue
    merged.push(candidate)
    seen.add(id)
  }
  return merged
}

const discoveryCacheKey = (input: {
  query: string
  topK?: number
  excludeIds?: readonly string[]
}) => JSON.stringify([
  input.query,
  Math.max(1, Math.trunc(Number(input.topK) || 10)),
  [...new Set(input.excludeIds || [])].map(value => clean(value, 300)).filter(Boolean).sort(),
  CAPABILITY_REGISTRY_VERSION,
  FOUNDATIONAL_SURFACE_VERSION,
])

const pruneDiscoveryCache = (now: number) => {
  for (const [key, entry] of discoveryCache) {
    if (entry.expiresAt <= now) discoveryCache.delete(key)
  }
  while (discoveryCache.size >= DISCOVERY_CACHE_MAX) {
    const oldestKey = discoveryCache.keys().next().value as string | undefined
    if (!oldestKey) break
    discoveryCache.delete(oldestKey)
  }
}

const runIndexedDiscovery = async (input: {
  client: any
  geminiApiKey: string
  query: string
  topK?: number
  excludeIds?: readonly string[]
}): Promise<IndexedCapabilityDiscoveryResult> => {
  try {
    const queryEmbedding = await embedCapabilityQuery(input.geminiApiKey, input.query)
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
    if (candidates.length) {
      return {
        candidates: withFoundationalCapabilities(candidates, input.excludeIds),
        mode: 'embedding_index',
      }
    }
    return {
      candidates: withFoundationalCapabilities(
        discoverCapabilityCandidates({ query: input.query, topK: input.topK, excludeIds: input.excludeIds }),
        input.excludeIds,
      ),
      mode: 'lexical_fallback',
      fallbackReason: 'embedding_index_empty',
    }
  } catch (error) {
    return {
      candidates: withFoundationalCapabilities(
        discoverCapabilityCandidates({ query: input.query, topK: input.topK, excludeIds: input.excludeIds }),
        input.excludeIds,
      ),
      mode: 'lexical_fallback',
      fallbackReason: error instanceof Error ? clean(error.message, 500) : 'embedding_index_failed',
    }
  }
}

export async function discoverIndexedCapabilities(input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
  excludeIds?: readonly string[]
}): Promise<IndexedCapabilityDiscoveryResult> {
  const query = clean(input.query, 2_000)
  if (!query) {
    return {
      candidates: withFoundationalCapabilities([], input.excludeIds),
      mode: 'lexical_fallback',
      fallbackReason: 'empty_query',
    }
  }

  if (!input.geminiApiKey) {
    return {
      candidates: withFoundationalCapabilities(
        discoverCapabilityCandidates({ query, topK: input.topK, excludeIds: input.excludeIds }),
        input.excludeIds,
      ),
      mode: 'lexical_fallback',
      fallbackReason: 'embedding_provider_unavailable',
    }
  }

  const now = Date.now()
  const key = discoveryCacheKey({ query, topK: input.topK, excludeIds: input.excludeIds })
  const cached = discoveryCache.get(key)
  if (cached && cached.expiresAt > now) return cached.promise
  if (cached) discoveryCache.delete(key)

  pruneDiscoveryCache(now)
  const entry: DiscoveryCacheEntry = {
    expiresAt: now + DISCOVERY_CACHE_TTL_MS,
    promise: Promise.resolve({ candidates: [], mode: 'lexical_fallback' }),
  }
  entry.promise = runIndexedDiscovery({
    client: input.client,
    geminiApiKey: input.geminiApiKey,
    query,
    topK: input.topK,
    excludeIds: input.excludeIds,
  }).then(result => {
    entry.expiresAt = Date.now() + (result.mode === 'embedding_index'
      ? DISCOVERY_CACHE_TTL_MS
      : DISCOVERY_FALLBACK_CACHE_TTL_MS)
    return result
  }).catch(error => {
    discoveryCache.delete(key)
    throw error
  })
  discoveryCache.set(key, entry)
  return entry.promise
}