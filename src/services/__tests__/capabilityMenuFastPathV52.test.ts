import { describe, expect, it } from 'vitest'
import { buildControllerCapabilitySurface, capabilitySessionObservation, startControllerCapabilitySession } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('Controller V5.2 compact capability menu fast path', () => {
  it('keeps the physical provider surface tiny while exposing logical names in the meta-tool description', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.tools.map(tool => tool.name)).toEqual(['report_progress', 'discover_more_capabilities', 'request_large_context'])
    const discover = surface.tools.find(tool => tool.name === 'discover_more_capabilities')
    expect(discover?.description).toContain('search_knowledge_catalog')
    expect(discover?.description).toContain('get_abap_source')
    expect(discover?.description).toContain('activate:name1,name2')
  })

  it('allows the semantic Controller to skip an unnecessary index round without runtime selection', async () => {
    const session = await startControllerCapabilitySession({ client: null, query: 'GET_SATILABILIR_LIMIT' })
    const observation = capabilitySessionObservation(session)
    expect(observation.instruction).toContain('sole semantic Controller')
    expect(observation.instruction).toContain('activate:name1,name2')
    expect(observation.instruction).toContain('do not call query="index" merely to re-read names already visible to you')
    expect(observation.instruction).toContain('Runtime performs exact-name/schema/order/budget validation only')
  })
})
