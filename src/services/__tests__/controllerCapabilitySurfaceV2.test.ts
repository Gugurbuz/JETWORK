import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  capabilitySessionObservation,
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  CONTROLLER_LOGICAL_CAPABILITY_TOOLS,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  INVOKE_CAPABILITY_TOOL_NAME,
  LOAD_CAPABILITY_CONTRACT_TOOL_NAME,
  LOAD_CAPABILITY_GUIDE_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('controller capability surface v5 progressive disclosure', () => {
  it('keeps all 33 logical capabilities while shrinking provider-visible schemas', () => {
    const surface = buildControllerCapabilitySurface([])

    expect(CONTROLLER_CAPABILITY_SURFACE_VERSION).toBe('controller-capability-surface-v5-progressive-disclosure')
    expect(surface.logicalToolNames).toHaveLength(33)
    expect(new Set(surface.logicalToolNames).size).toBe(33)
    expect(surface.logicalToolNames).toContain('search_knowledge_catalog')
    expect(surface.logicalToolNames).toContain('get_message_detail')
    expect(surface.logicalToolNames).toContain('get_abap_source')
    expect(surface.logicalToolNames).toContain('get_related_objects')
    expect(surface.logicalToolNames).toContain('create_document_file')
    expect(surface.logicalToolNames).toContain(REVIEW_EVIDENCE_COVERAGE_TOOL_NAME)

    expect(surface.toolNames).toEqual([
      'report_progress',
      LOAD_CAPABILITY_GUIDE_TOOL_NAME,
      LOAD_CAPABILITY_CONTRACT_TOOL_NAME,
      INVOKE_CAPABILITY_TOOL_NAME,
      'request_large_context',
    ])
    expect(surface.toolNames).not.toContain('search_knowledge_catalog')
    expect(surface.toolNames).not.toContain(DISCOVER_MORE_CAPABILITIES_TOOL_NAME)
    expect(surface.providerWebVisible).toBe(true)
  })

  it('publishes a meaningful 1-2 sentence Layer-1 summary for every logical capability', () => {
    const surface = buildControllerCapabilitySurface([])
    expect(surface.capabilityIndex).toHaveLength(33)
    for (const item of surface.capabilityIndex) {
      expect(item.name.length).toBeGreaterThan(2)
      expect(item.summary.length).toBeGreaterThanOrEqual(80)
      expect(item.summary).toMatch(/[.!?]$/)
    }
  })

  it('makes the physical schema surface materially smaller than the canonical logical schemas', () => {
    const surface = buildControllerCapabilitySurface([])
    const physical = JSON.stringify(surface.tools).length
    const canonical = JSON.stringify(CONTROLLER_LOGICAL_CAPABILITY_TOOLS).length
    expect(physical).toBeLessThan(canonical * 0.3)
  })

  it('returns an observation that exposes the full Layer-1 index without choosing a capability', () => {
    const surface = buildControllerCapabilitySurface([])
    const observation = capabilitySessionObservation({
      version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
      discoveryMode: 'progressive_disclosure',
      seenCandidateIds: [],
      surface,
    })

    expect(observation.discoveryMode).toBe('progressive_disclosure')
    expect(observation.logicalCapabilityCount).toBe(33)
    expect(observation.capabilityIndex).toContain('search_knowledge_catalog')
    expect(observation.capabilityIndex).toContain('get_message_detail')
    expect(observation.instruction).toContain('Layer-2')
    expect(observation.instruction).toContain('Layer-3')
    expect(observation.instruction).toContain('Runtime capability')
    expect(observation.instruction).toContain('aynı Controller')
  })

  it('contains no runtime-authored semantic route or mandatory next-tool protocol', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('CONTROLLER_TOOL_GUIDANCE')
    expect(source).not.toContain('discoverIndexedCapabilities')
    expect(source).not.toContain('pendingCandidateKeys')
    expect(source).not.toContain('next knowledge call MUST')
    expect(source).toContain('active Controller still sees every logical option')
    expect(source).toContain('Runtime capability, sorgu veya sonraki adımı seçmez')
  })
})
