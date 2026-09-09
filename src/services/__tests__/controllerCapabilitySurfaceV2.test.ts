import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  capabilitySessionObservation,
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('controller capability surface v4', () => {
  it('keeps the complete registered JetWork semantic surface available without semantic Top-K routing', () => {
    const surface = buildControllerCapabilitySurface([])

    expect(CONTROLLER_CAPABILITY_SURFACE_VERSION).toBe('controller-capability-surface-v4-public-work-plan')
    expect(surface.toolNames[0]).toBe('report_progress')
    expect(surface.toolNames).toContain('search_knowledge_catalog')
    expect(surface.toolNames).toContain('get_knowledge_object')
    expect(surface.toolNames).toContain('get_related_objects')
    expect(surface.toolNames).toContain('search_skills')
    expect(surface.toolNames).toContain('load_skills')
    expect(surface.toolNames).toContain('list_capabilities')
    expect(surface.toolNames).toContain(REVIEW_EVIDENCE_COVERAGE_TOOL_NAME)
    expect(surface.toolNames).toContain('request_large_context')
    expect(surface.toolNames).not.toContain(DISCOVER_MORE_CAPABILITIES_TOOL_NAME)
    expect(surface.providerWebVisible).toBe(true)
    expect(surface.candidateIds).toEqual([])
    expect(surface.candidates).toEqual([])
  })

  it('separates ranked discovery, exact detail and enumeration semantics without routing the model', () => {
    const surface = buildControllerCapabilitySurface([])
    const byName = new Map(surface.tools.map(tool => [tool.name, tool]))
    expect(String(byName.get('search_knowledge_catalog')?.description)).toContain('ranked candidate discovery')
    expect(String(byName.get('search_knowledge_catalog')?.description)).toContain('jointly meaningful user terms together')
    expect(String(byName.get('search_knowledge_catalog')?.description)).toContain('zero-result candidate search is an observation')
    expect(String(byName.get('get_abap_source')?.description)).toContain('remaining evidence gap')
    expect(String(byName.get('list_knowledge_catalog')?.description)).toContain('enumeration capability')
    expect(String(byName.get('list_knowledge_catalog')?.description)).toContain('nextCursor only means more records exist')
    expect(String(byName.get('list_knowledge_catalog')?.description)).toContain('never an instruction to fetch the next page')
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

  it('returns an observation that leaves retrieval, evidence-gap and stop decisions to the controller model', () => {
    const surface = buildControllerCapabilitySurface([])
    const observation = capabilitySessionObservation({
      version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
      discoveryMode: 'full_surface',
      seenCandidateIds: [],
      surface,
    })

    expect(observation.discoveryMode).toBe('full_surface')
    expect(observation.instruction).toContain('retrieval strategy')
    expect(observation.instruction).toContain('evidence-gap evaluation')
    expect(observation.instruction).toContain('controller model')
    expect(observation.instruction).toContain('nextCursor only signals availability')
    expect(observation.instruction).toContain('zero-result candidate search is not proof of absence')
    expect(observation.instruction).not.toContain('must verify')
    expect(observation.instruction).not.toContain('pendingCandidateKeys')
  })

  it('contains no runtime-authored semantic mandatory-next-tool protocol', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('CONTROLLER_TOOL_GUIDANCE')
    expect(source).not.toContain('discoverIndexedCapabilities')
    expect(source).not.toContain('pendingCandidateKeys')
    expect(source).not.toContain('retry the blocked query')
    expect(source).not.toContain('next knowledge call MUST')
    expect(source).toContain('complete JetWork semantic capability surface')
    expect(source).toContain('lifecycle/control capability')
  })
})