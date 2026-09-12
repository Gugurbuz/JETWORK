import { describe, expect, it } from 'vitest'
import {
  capabilitySessionObservation,
  discoverMoreForController,
  startControllerCapabilitySession,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('V5.1 low-latency progressive disclosure fast path', () => {
  it('collapses guide + contract into one exact-name activation without runtime semantic selection', async () => {
    let session = await startControllerCapabilitySession({ client: null, query: 'GET_SATILABILIR_LIMIT' })
    session = await discoverMoreForController({ client: null, query: 'index', limit: 4, session })
    expect(session.lastDisclosure.layer).toBe('index')

    session = await discoverMoreForController({
      client: null,
      query: 'activate:search_knowledge_catalog,get_abap_source',
      limit: 4,
      session,
    })

    expect(session.lastDisclosure.layer).toBe('activated')
    expect(session.guidedToolNames).toEqual(['search_knowledge_catalog', 'get_abap_source'])
    expect(session.activatedToolNames).toEqual(['search_knowledge_catalog', 'get_abap_source'])
    expect(session.surface.toolNames).toContain('search_knowledge_catalog')
    expect(session.surface.toolNames).toContain('get_abap_source')
  })

  it('keeps legacy disclosure compatible while V5.3 instructs semantic action batching', async () => {
    const session = await startControllerCapabilitySession({ client: null, query: 'test' })
    const instruction = capabilitySessionObservation(session).instruction
    expect(instruction).toContain('Capability catalog is lazy')
    expect(instruction).toContain('discover_more_capabilities')
    expect(instruction).toContain('Runtime only validates name/schema/permission/budget')
  })
})
