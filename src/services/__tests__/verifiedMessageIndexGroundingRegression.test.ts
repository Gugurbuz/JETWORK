import { describe, expect, it } from 'vitest'
import { evaluateGroundedTechnicalClaims } from '../../../supabase/functions/_shared/groundingGuard'
import { buildControllerCapabilitySurface, capabilitySessionObservation } from '../../../supabase/functions/_shared/capabilities/controllerSurface'

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

  it('requires exhaustive direct-message candidate verification and fully-qualified code-only output', () => {
    const surface = buildControllerCapabilitySurface([{
      id: 'skill:sap/message-analysis',
      kind: 'skill',
      category: 'skill',
      title: 'SAP message analysis',
      description: '',
      skillKey: 'sap/message-analysis',
      declaredTools: ['knowledge'],
      executorTools: ['search_knowledge_catalog', 'get_knowledge_object', 'get_knowledge_objects', 'get_related_objects'],
      score: 1,
      semanticScore: 1,
      lexicalScore: 1,
      registryVersion: 'test',
      discoveryVersion: 'test',
    }])

    const exactTool = surface.tools.find(tool => tool.name === 'get_knowledge_object')
    const batchTool = surface.tools.find(tool => tool.name === 'get_knowledge_objects')
    const searchTool = surface.tools.find(tool => tool.name === 'search_knowledge_catalog')
    const observation = capabilitySessionObservation({
      version: 'controller-capability-surface-v2',
      discoveryMode: 'lexical_fallback',
      fallbackReason: 'test',
      seenCandidateIds: surface.candidateIds,
      surface,
    })

    expect(exactTool?.description).toContain('fully-qualified canonical identifier')
    expect(exactTool?.description).toContain('`ZCRM_COST-007`, never bare `007`')
    expect(exactTool?.description).toContain('answer with canonical message codes only')
    expect(batchTool?.description).toContain('exact-verify every directly relevant message candidate')
    expect(batchTool?.description).toContain('full message-class prefix repeated on every code')
    expect(searchTool?.description).toContain('all three must be exact-verified before finalizing')
    expect(observation.instruction).toContain('never compress a list to bare numbers')
    expect(observation.instruction).toContain('answer code-only')
  })
})
