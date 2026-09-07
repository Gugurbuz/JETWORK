import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  capabilitySessionObservation,
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('controller capability surface v3', () => {
  it('exposes the complete registered JetWork tool surface without semantic Top-K filtering', () => {
    const surface = buildControllerCapabilitySurface([])

    expect(CONTROLLER_CAPABILITY_SURFACE_VERSION).toBe('controller-capability-surface-v3-full')
    expect(surface.toolNames).toContain('search_knowledge_catalog')
    expect(surface.toolNames).toContain('get_knowledge_object')
    expect(surface.toolNames).toContain('get_related_objects')
    expect(surface.toolNames).toContain('search_skills')
    expect(surface.toolNames).toContain('load_skills')
    expect(surface.toolNames).toContain('list_capabilities')
    expect(surface.toolNames).toContain(REVIEW_EVIDENCE_COVERAGE_TOOL_NAME)
    expect(surface.toolNames).toContain('report_progress')
    expect(surface.toolNames).toContain('request_large_context')
    expect(surface.toolNames).not.toContain(DISCOVER_MORE_CAPABILITIES_TOOL_NAME)
    expect(surface.providerWebVisible).toBe(true)
    expect(surface.candidateIds).toEqual([])
    expect(surface.candidates).toEqual([])
  })

  it('ignores legacy candidate input for semantic availability', () => {
    const surface = buildControllerCapabilitySurface([{
      id: 'legacy:candidate',
      toolName: 'get_message_detail',
    }])

    expect(surface.toolNames).toContain('get_message_detail')
    expect(surface.toolNames).toContain('search_knowledge_catalog')
    expect(surface.candidateIds).toEqual([])
  })

  it('returns an observation that leaves retrieval and stop decisions to the controller model', () => {
    const surface = buildControllerCapabilitySurface([])
    const observation = capabilitySessionObservation({
      version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
      discoveryMode: 'full_surface',
      seenCandidateIds: [],
      surface,
    })

    expect(observation.discoveryMode).toBe('full_surface')
    expect(observation.instruction).toContain('retrieval strategy')
    expect(observation.instruction).toContain('controller model')
    expect(observation.instruction).not.toContain('must verify')
    expect(observation.instruction).not.toContain('nextCursor')
    expect(observation.instruction).not.toContain('pendingCandidateKeys')
  })

  it('contains no runtime-authored mandatory next-tool protocol', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('CONTROLLER_TOOL_GUIDANCE')
    expect(source).not.toContain('discoverIndexedCapabilities')
    expect(source).not.toContain('pendingCandidateKeys')
    expect(source).not.toContain('retry the blocked query')
    expect(source).not.toContain('next knowledge call MUST')
    expect(source).toContain('complete JetWork capability surface')
  })
})
