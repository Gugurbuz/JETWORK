import {
  CAPABILITY_REGISTRY,
  CAPABILITY_REGISTRY_VERSION,
  type CapabilityRegistryItem,
} from './registry.ts'

export const CAPABILITY_DISCOVERY_VERSION = 'capability-discovery-v2'

export interface CapabilityEmbeddingIndex {
  query: number[]
  candidates: Record<string, number[] | undefined>
}

export interface CapabilityCandidate {
  id: string
  kind: CapabilityRegistryItem['kind']
  category: CapabilityRegistryItem['category']
  title: string
  description: string
  toolName?: string
  skillKey?: string
  score: number
  semanticScore: number | null
  lexicalScore: number
  registryVersion: string
  discoveryVersion: string
}

const normalize = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9/_ -]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const STOP = new Set(['bir','bu','ve','veya','ile','icin','mi','mu','the','a','an','to','of','and','or'])
const tokens = (value: unknown) => [...new Set(normalize(value)
  .split(/[\s/_-]+/u)
  .map(token => token.trim())
  .filter(token => token.length >= 2 && !STOP.has(token)))]

const lexicalScore = (query: string, item: CapabilityRegistryItem) => {
  const q = normalize(query)
  const haystack = normalize(item.semanticText)
  if (!q || !haystack) return 0
  const qTokens = tokens(q)
  if (!qTokens.length) return 0
  const hTokens = new Set(tokens(haystack))
  let overlap = 0
  for (const token of qTokens) {
    if (hTokens.has(token)) overlap += 1
    else if (haystack.includes(token)) overlap += 0.45
  }
  const coverage = overlap / qTokens.length
  const exactPhrase = haystack.includes(q) ? 0.35 : 0
  const identity = normalize(item.title).includes(q) || normalize(item.id).includes(q) ? 0.25 : 0
  return Math.min(1, coverage * 0.7 + exactPhrase + identity)
}

const cosineSimilarity = (left: number[] | undefined, right: number[] | undefined): number | null => {
  if (!left?.length || !right?.length || left.length !== right.length) return null
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const l = Number(left[index])
    const r = Number(right[index])
    if (!Number.isFinite(l) || !Number.isFinite(r)) return null
    dot += l * r
    leftNorm += l * l
    rightNorm += r * r
  }
  if (!leftNorm || !rightNorm) return null
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

const boundedTopK = (value: number | undefined) => Math.max(1, Math.min(Math.trunc(Number(value) || 10), 12))

/**
 * Candidate retrieval only. A high score means "likely relevant"; it never
 * authorizes or executes a capability. The controller LLM remains the semantic
 * decision authority after receiving these candidates.
 *
 * When embedding vectors are available, semantic similarity dominates the
 * ranking. Lexical relevance remains a small recall/tie-break signal and is the
 * safe fallback while an embedding index is warming or unavailable.
 */
export const discoverCapabilityCandidates = (input: {
  query: string
  registry?: readonly CapabilityRegistryItem[]
  embeddings?: CapabilityEmbeddingIndex | null
  topK?: number
  excludeIds?: readonly string[]
  categories?: readonly CapabilityRegistryItem['category'][]
}): CapabilityCandidate[] => {
  const registry = input.registry || CAPABILITY_REGISTRY
  const topK = boundedTopK(input.topK)
  const excluded = new Set(input.excludeIds || [])
  const categories = input.categories?.length ? new Set(input.categories) : null

  return registry
    .filter(item => !excluded.has(item.id) && (!categories || categories.has(item.category)))
    .map(item => {
      const lexical = lexicalScore(input.query, item)
      const semantic = input.embeddings
        ? cosineSimilarity(input.embeddings.query, input.embeddings.candidates[item.id])
        : null
      const normalizedSemantic = semantic === null ? null : Math.max(0, Math.min(1, (semantic + 1) / 2))
      const score = normalizedSemantic === null
        ? lexical
        : normalizedSemantic * 0.82 + lexical * 0.18
      return { item, lexical, semantic: normalizedSemantic, score }
    })
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || right.lexical - left.lexical || left.item.id.localeCompare(right.item.id))
    .slice(0, topK)
    .map(({ item, lexical, semantic, score }) => ({
      id: item.id,
      kind: item.kind,
      category: item.category,
      title: item.title,
      description: item.description,
      toolName: item.toolName,
      skillKey: item.skillKey,
      score: Number(score.toFixed(6)),
      semanticScore: semantic === null ? null : Number(semantic.toFixed(6)),
      lexicalScore: Number(lexical.toFixed(6)),
      registryVersion: CAPABILITY_REGISTRY_VERSION,
      discoveryVersion: CAPABILITY_DISCOVERY_VERSION,
    }))
}

export const discoverMoreCapabilities = (input: {
  query: string
  seenCandidateIds: readonly string[]
  registry?: readonly CapabilityRegistryItem[]
  embeddings?: CapabilityEmbeddingIndex | null
  topK?: number
}) => discoverCapabilityCandidates({
  query: input.query,
  registry: input.registry,
  embeddings: input.embeddings,
  topK: input.topK,
  excludeIds: input.seenCandidateIds,
})
