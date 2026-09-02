import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import type { CapabilityCandidate } from '../../../supabase/functions/_shared/capabilities/discovery.ts'

const candidate = (input: Partial<CapabilityCandidate> & Pick<CapabilityCandidate, 'id'|'kind'|'category'|'title'>): CapabilityCandidate => ({
  description: '',
  score: 0.9,
  semanticScore: 0.9,
  lexicalScore: 0,
  registryVersion: 'capability-registry-v2',
  discoveryVersion: 'capability-discovery-v2',
  ...input,
})

describe('controller capability surface v2', () => {
  it('exposes only candidate tools plus mechanical discovery/load meta tools', () => {
    const surface = buildControllerCapabilitySurface([
      candidate({ id: 'tool:get_message_detail', kind: 'tool', category: 'knowledge', title: 'get_message_detail', toolName: 'get_message_detail' }),
      candidate({ id: 'skill:business-analysis', kind: 'skill', category: 'skill', title: 'Business analysis', skillKey: 'business-analysis' }),
    ])

    expect(surface.toolNames).toContain('get_message_detail')
    expect(surface.toolNames).toContain('load_skills')
    expect(surface.toolNames).toContain('list_capabilities')
    expect(surface.toolNames).toContain(DISCOVER_MORE_CAPABILITIES_TOOL_NAME)
    expect(surface.skillKeys).toEqual(['business-analysis'])
    expect(surface.toolNames).not.toContain('search_knowledge_catalog')
    expect(surface.providerWebVisible).toBe(false)
  })

  it('keeps provider web as a candidate capability instead of globally enabling it', () => {
    const surface = buildControllerCapabilitySurface([
      candidate({ id: 'provider:web_search', kind: 'provider_capability', category: 'web', title: 'Provider web', toolName: 'provider_web' }),
    ])
    expect(surface.providerWebVisible).toBe(true)
  })

  it('discover-more excludes already surfaced candidates and stays candidate-only', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('excludeIds: input.session.seenCandidateIds')
    expect(source).toContain('These are candidate capabilities only')
    expect(source).not.toContain('executeAssistantTool(')
    expect(source).not.toContain('executeSkillTool(')
  })
})
