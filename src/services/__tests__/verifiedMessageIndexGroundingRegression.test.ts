import { describe, expect, it } from 'vitest'
import { evaluateGroundedTechnicalClaims } from '../../../supabase/functions/_shared/groundingGuard'
import { buildControllerCapabilitySurface, capabilitySessionObservation, CONTROLLER_CAPABILITY_SURFACE_VERSION } from '../../../supabase/functions/_shared/capabilities/controllerSurface'

describe('verified ABAP message index grounding regression', () => {
  it('accepts message codes carried by the mechanically preserved index in a verified exact record', () => {
    const toolResult = {
      output: JSON.stringify({
        securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
        tool: 'get_knowledge_object',
        citationReady: true,
        records: [{
          canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
          objectType: 'method',
          name: 'NINJA_CALCULATE_ONCRM',
          title: 'NINJA_CALCULATE_ONCRM',
          summary: 'Verified ABAP method source',
          content: '[VERIFIED_ABAP_MESSAGE_CODES]\nZCRM_COST-000, ZCRM_COST-164\n[END_VERIFIED_ABAP_MESSAGE_CODES]\nMETHOD ninja_calculate_oncrm.',
        }],
      }),
      sources: [{
        sourceId: 'source-1',
        canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
        objectType: 'method',
      }],
      summary: { citationReady: true, resultCount: 1 },
    }

    const coverage = evaluateGroundedTechnicalClaims({
      text: 'ZCRM_COST-000, ZCRM_COST-164',
      plan: { knowledgeRequired: false, enterpriseGroundingRequired: false },
      sources: toolResult.sources,
      toolResults: [toolResult],
      currentUserText: 'ninja_calculate_oncrm hangi mesajları üretiyor?',
    })

    expect(coverage.ok).toBe(true)
    expect(coverage.unsupportedIdentifiers).toEqual([])
  })

  it('keeps message grounding mechanical instead of encoding a mandatory retrieval sequence in the capability surface', () => {
    const surface = buildControllerCapabilitySurface([])
    const observation = capabilitySessionObservation({
      version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
      discoveryMode: 'full_surface',
      seenCandidateIds: [],
      surface,
    })

    expect(surface.toolNames).toContain('search_knowledge_catalog')
    expect(surface.toolNames).toContain('get_knowledge_object')
    expect(surface.toolNames).toContain('get_knowledge_objects')
    expect(surface.toolNames).toContain('get_related_objects')
    expect(observation.instruction).toContain('controller model')
    expect(observation.instruction).not.toContain('exact-verify')
    expect(observation.instruction).not.toContain('pending candidate')
    expect(observation.instruction).not.toContain('answer code-only')
  })
})
