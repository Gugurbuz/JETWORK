import { describe, expect, it } from 'vitest'
import { evaluateGroundedTechnicalClaims } from '../../../supabase/functions/_shared/groundingGuard'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface'

describe('verified ABAP message index grounding regression', () => {
  it('accepts message codes carried by a verified tool envelope even when compacted records are not object-shaped', () => {
    const toolResult = {
      output: JSON.stringify({
        securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
        tool: 'get_knowledge_object',
        citationReady: true,
        records: '[VERIFIED_ABAP_MESSAGE_CODES]\nZCRM_COST-000, ZCRM_COST-164\n[END_VERIFIED_ABAP_MESSAGE_CODES]',
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

  it('tells the controller that ABAP message indexes prove codes, not unverified human-readable message text', () => {
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
    const searchTool = surface.tools.find(tool => tool.name === 'search_knowledge_catalog')

    expect(exactTool?.description).toContain('block proves the emitted message codes only')
    expect(exactTool?.description).toContain('without inventing or paraphrasing message text')
    expect(searchTool?.description).toContain('verify those message candidates')
    expect(searchTool?.description).toContain('Never final-answer from candidate titles')
  })
})
