import { describe, expect, it } from 'vitest'
import {
  CONTROLLER_LOGICAL_CAPABILITY_TOOLS,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
  loadCapabilityContracts,
  loadCapabilityGuides,
  resolveCapabilityInvocation,
} from '../../../supabase/functions/_shared/capabilities/progressiveDisclosure.ts'
import { validateCanonicalToolArguments } from '../../../supabase/functions/_shared/capabilities/canonicalToolValidation.ts'

const substantive = CONTROLLER_LOGICAL_CAPABILITY_TOOLS.filter(tool => !['report_progress', 'request_large_context'].includes(tool.name))

describe('progressive capability disclosure chain', () => {
  it('requires Layer-2 guide before Layer-3 contract and Layer-3 token before invocation', async () => {
    const guideBundle = await loadCapabilityGuides(substantive, ['search_knowledge_catalog'])
    const guide = guideBundle.records[0]

    expect(guide.capabilityName).toBe('search_knowledge_catalog')
    expect(guide.purpose).toContain('Jetbase')
    expect(guide.whenToUse).toContain('Exact hedef')
    expect(guide.outputSemantics).toContain('citationReady=false')
    expect(guide.guideToken.length).toBe(64)

    await expect(loadCapabilityContracts(substantive, [{
      capabilityName: 'search_knowledge_catalog',
      guideToken: 'invalid-token',
    }])).rejects.toThrow(/guide token/i)

    const contractBundle = await loadCapabilityContracts(substantive, [{
      capabilityName: 'search_knowledge_catalog',
      guideToken: guide.guideToken,
    }])
    const contract = contractBundle.records[0]
    expect(contract.parameters).toEqual(expect.objectContaining({ type: 'object' }))
    expect(contract.contractToken.length).toBe(64)

    await expect(resolveCapabilityInvocation(substantive, {
      capabilityName: 'search_knowledge_catalog',
      contractToken: 'invalid-token',
      argumentsJson: '{}',
    })).rejects.toThrow(/contract token/i)

    const resolved = await resolveCapabilityInvocation(substantive, {
      capabilityName: 'search_knowledge_catalog',
      contractToken: contract.contractToken,
      argumentsJson: JSON.stringify({ query: 'ZCRM_COST-111', objectTypes: null, limit: 6 }),
    })
    expect(resolved).toEqual({
      capabilityName: 'search_knowledge_catalog',
      args: { query: 'ZCRM_COST-111', objectTypes: null, limit: 6 },
    })
  })

  it('rejects invented capabilities and canonical argument violations', async () => {
    await expect(loadCapabilityGuides(substantive, ['invented_tool'])).rejects.toThrow(/Unknown JetWork capability/)

    const guideBundle = await loadCapabilityGuides(substantive, ['get_message_detail'])
    const contractBundle = await loadCapabilityContracts(substantive, [{
      capabilityName: 'get_message_detail',
      guideToken: guideBundle.records[0].guideToken,
    }])
    const resolved = await resolveCapabilityInvocation(substantive, {
      capabilityName: 'get_message_detail',
      contractToken: contractBundle.records[0].contractToken,
      argumentsJson: JSON.stringify({ messageCode: 'ZCRM_COST-111', invented: true }),
    })

    expect(() => validateCanonicalToolArguments(substantive, resolved.capabilityName, resolved.args))
      .toThrow(/invented is not allowed/)
  })

  it('supports loading several serious candidates without selecting one for the controller', async () => {
    const bundle = await loadCapabilityGuides(substantive, [
      'search_knowledge_catalog',
      'search_document',
      'search_web',
    ])
    expect(bundle.records.map(record => record.capabilityName)).toEqual([
      'search_knowledge_catalog',
      'search_document',
      'search_web',
    ])
    expect(bundle.instruction).toContain('seçim değildir')
  })
})
