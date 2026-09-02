import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_REGISTRY,
  CAPABILITY_REGISTRY_VERSION,
  type CapabilityRegistryItem,
} from '../../../supabase/functions/_shared/capabilities/registry.ts'
import {
  CAPABILITY_DISCOVERY_VERSION,
  discoverCapabilityCandidates,
  discoverMoreCapabilities,
} from '../../../supabase/functions/_shared/capabilities/discovery.ts'

const discoverySource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/discovery.ts', import.meta.url),
  'utf8',
)

const item = (id: string, category: CapabilityRegistryItem['category'], semanticText: string): CapabilityRegistryItem => ({
  id,
  version: '1',
  kind: id.startsWith('skill:') ? 'skill' : 'tool',
  category,
  title: id,
  description: semanticText,
  semanticText,
  toolName: id.startsWith('tool:') ? id.slice(5) : undefined,
  skillKey: id.startsWith('skill:') ? id.slice(6) : undefined,
  metadata: {},
})

describe('Semantic Capability Discovery v2', () => {
  it('builds one deduplicated registry across skills, knowledge, artifact and web capabilities', () => {
    expect(CAPABILITY_REGISTRY_VERSION).toBe('capability-registry-v2')
    expect(new Set(CAPABILITY_REGISTRY.map(candidate => candidate.id)).size).toBe(CAPABILITY_REGISTRY.length)
    const categories = new Set(CAPABILITY_REGISTRY.map(candidate => candidate.category))
    for (const category of ['skill','knowledge','artifact','web'] as const) expect(categories.has(category)).toBe(true)
    expect(CAPABILITY_REGISTRY.some(candidate => candidate.id === 'tool:load_document_contract')).toBe(true)
    expect(CAPABILITY_REGISTRY.some(candidate => candidate.id === 'provider:web_search')).toBe(true)
  })

  it('returns a bounded Top-K candidate set and never execution authority', () => {
    const candidates = discoverCapabilityCandidates({
      query: 'Enerjisa ihtiyaç analizi dokümanı oluştur',
      topK: 99,
    })
    expect(CAPABILITY_DISCOVERY_VERSION).toBe('capability-discovery-v2')
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.length).toBeLessThanOrEqual(12)
    expect(candidates.every(candidate => candidate.discoveryVersion === CAPABILITY_DISCOVERY_VERSION)).toBe(true)
    expect(discoverySource).toContain('Candidate retrieval only')
    expect(discoverySource).not.toContain('executeAssistantTool')
    expect(discoverySource).not.toContain('executeSkillTool')
  })

  it('lets semantic embeddings dominate lexical coincidence when vectors are available', () => {
    const registry = [
      item('tool:knowledge', 'knowledge', 'exact SAP source lookup'),
      item('tool:artifact', 'artifact', 'document renderer'),
      item('provider:web', 'web', 'public internet research'),
    ]
    const candidates = discoverCapabilityCandidates({
      query: 'completely unrelated words',
      registry,
      topK: 3,
      embeddings: {
        query: [1, 0],
        candidates: {
          'tool:knowledge': [0.05, 0.95],
          'tool:artifact': [1, 0],
          'provider:web': [0, 1],
        },
      },
    })
    expect(candidates[0].id).toBe('tool:artifact')
    expect(candidates[0].semanticScore).toBe(1)
  })

  it('supports discover-more without returning candidates the controller already saw', () => {
    const registry = [
      item('skill:a', 'skill', 'enterprise analysis'),
      item('skill:b', 'skill', 'enterprise analysis documentation'),
      item('skill:c', 'skill', 'enterprise analysis integration'),
    ]
    const first = discoverCapabilityCandidates({ query: 'enterprise analysis', registry, topK: 1 })
    const next = discoverMoreCapabilities({
      query: 'enterprise analysis',
      registry,
      seenCandidateIds: first.map(candidate => candidate.id),
      topK: 2,
    })
    expect(first).toHaveLength(1)
    expect(next).toHaveLength(2)
    expect(next.some(candidate => candidate.id === first[0].id)).toBe(false)
  })
})
