import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  capabilitySessionObservation,
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  getCanonicalCapabilityTool,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('controller capability surface v5', () => {
  it('keeps the complete logical JetWork surface while initial physical schemas stay minimal', () => {
    const surface = buildControllerCapabilitySurface([])

    expect(CONTROLLER_CAPABILITY_SURFACE_VERSION).toBe('controller-capability-surface-v5.3-semantic-action-batch')
    expect(surface.toolNames).toEqual([
      'report_progress',
      'discover_more_capabilities',
      'execute_capabilities',
      'request_large_context',
    ])
    expect(surface.logicalToolNames).toContain('search_knowledge_catalog')
    expect(surface.logicalToolNames).toContain('get_knowledge_object')
    expect(surface.logicalToolNames).toContain('get_related_objects')
    expect(surface.logicalToolNames).toContain('search_skills')
    expect(surface.logicalToolNames).toContain('load_skills')
    expect(surface.logicalToolNames).toContain('list_capabilities')
    expect(surface.logicalToolNames).toContain('review_evidence_coverage')
    expect(surface.logicalToolNames).toHaveLength(33)
    expect(surface.logicalToolNames).not.toContain(DISCOVER_MORE_CAPABILITIES_TOOL_NAME)
    expect(surface.providerWebVisible).toBe(false)
    expect(surface.candidateIds).toEqual([])
    expect(surface.candidates).toEqual([])
  })

  it('retains exact canonical retrieval contracts behind Layer 3', () => {
    expect(String(getCanonicalCapabilityTool('search_knowledge_catalog')?.description)).toContain('ranked candidate discovery')
    expect(String(getCanonicalCapabilityTool('search_knowledge_catalog')?.description)).toContain('jointly meaningful user terms together')
    expect(String(getCanonicalCapabilityTool('search_knowledge_catalog')?.description)).toContain('zero-result candidate search is an observation')
    expect(String(getCanonicalCapabilityTool('get_abap_source')?.description)).toContain('remaining evidence gap')
    expect(String(getCanonicalCapabilityTool('list_knowledge_catalog')?.description)).toContain('enumeration capability')
    expect(String(getCanonicalCapabilityTool('list_knowledge_catalog')?.description)).toContain('nextCursor only means more records exist')
  })

  it('ignores legacy candidate input for semantic availability', () => {
    const surface = buildControllerCapabilitySurface([{ id: 'legacy:candidate', toolName: 'get_message_detail' }])
    expect(surface.logicalToolNames).toContain('get_message_detail')
    expect(surface.logicalToolNames).toContain('search_knowledge_catalog')
    expect(surface.candidateIds).toEqual([])
  })

  it('returns a progressive observation that leaves all semantic decisions to the controller model', () => {
    const surface = buildControllerCapabilitySurface([])
    const observation = capabilitySessionObservation({
      version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
      discoveryMode: 'semantic_action_batch',
      seenCandidateIds: [],
      guidedToolNames: [],
      activatedToolNames: [],
      lastDisclosure: { layer: 'ready', records: [] },
      surface,
    })

    expect(observation.discoveryMode).toBe('semantic_action_batch')
    expect(observation.instruction).toContain('Capability catalog is lazy')
    expect(observation.instruction).toContain('discover_more_capabilities')
    expect(observation.instruction).toContain('Runtime never makes the semantic choice')
    expect(observation.instruction).not.toContain('must verify')
    expect(observation.instruction).not.toContain('pendingCandidateKeys')
  })

  it('contains no runtime-authored semantic mandatory-next-tool protocol', () => {
    const source = readFileSync(new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('CONTROLLER_TOOL_GUIDANCE')
    expect(source).toContain('discoverIndexedCapabilities')
    expect(source).not.toContain('pendingCandidateKeys')
    expect(source).not.toContain('next knowledge call MUST')
    expect(source).toContain('semantic action batching')
    expect(source).toContain("layer: 'semantic'")
    expect(source).toContain('semantic Controller')
  })
})