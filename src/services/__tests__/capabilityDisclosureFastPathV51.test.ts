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

  it('tells the Controller to batch progress + discovery and independent calls while keeping semantic authority', async () => {
    const session = await startControllerCapabilitySession({ client: null, query: 'test' })
    const instruction = capabilitySessionObservation(session).instruction
    expect(instruction).toContain('sole semantic Controller')
    expect(instruction).toContain('query="activate:name1,name2"')
    expect(instruction).toContain('same first model output')
    expect(instruction).toContain('same model response rather than serializing needless model rounds')
    expect(instruction).toContain('never infers intent, chooses a capability')
  })
})
