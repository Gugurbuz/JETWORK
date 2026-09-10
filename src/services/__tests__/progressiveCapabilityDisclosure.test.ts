import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  capabilitySessionObservation,
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  discoverMoreForController,
  getCanonicalCapabilityTool,
  startControllerCapabilitySession,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
  JETWORK_CAPABILITY_INDEX,
  JETWORK_LOGICAL_CAPABILITY_NAMES,
} from '../../../supabase/functions/_shared/capabilities/progressiveDisclosure.ts'
import { toOllamaTools } from '../../../supabase/functions/_shared/ollamaProvider.ts'

describe('Controller V5 progressive capability disclosure', () => {
  it('keeps 33 logical capabilities while initial provider surface stays tiny', () => {
    const surface = buildControllerCapabilitySurface()
    expect(CONTROLLER_CAPABILITY_SURFACE_VERSION).toBe('controller-capability-surface-v5-progressive-disclosure')
    expect(JETWORK_LOGICAL_CAPABILITY_NAMES).toHaveLength(33)
    expect(surface.logicalToolNames).toHaveLength(33)
    expect(surface.logicalToolNames).toEqual(JETWORK_LOGICAL_CAPABILITY_NAMES)
    expect(surface.tools.map(tool => tool.name)).toEqual([
      'report_progress',
      'discover_more_capabilities',
      'request_large_context',
    ])
    expect(surface.providerWebVisible).toBe(false)
  })

  it('keeps the initial Ollama native dispatcher payload bounded before Layer-1 is requested', () => {
    const surface = buildControllerCapabilitySurface()
    const ollamaTools = toOllamaTools(surface.tools as unknown as Array<Record<string, unknown>>)
    expect(ollamaTools).toHaveLength(1)
    expect(JSON.stringify(ollamaTools).length).toBeLessThan(2_000)
    expect(JSON.stringify(ollamaTools)).not.toContain('search_knowledge_catalog')
    expect(JSON.stringify(ollamaTools)).not.toContain('create_document_file')
  })

  it('gives every logical capability a meaningful Layer-1 summary and Layer-2 guide', () => {
    expect(JETWORK_CAPABILITY_INDEX).toHaveLength(33)
    for (const capability of JETWORK_CAPABILITY_INDEX) {
      expect(capability.summary.length).toBeGreaterThanOrEqual(90)
      expect(capability.guide.length).toBeGreaterThanOrEqual(80)
    }
  })

  it('does not expose exact canonical schemas before Layer 3 activation', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.tools.some(tool => tool.name === 'search_knowledge_catalog')).toBe(false)
    expect(surface.tools.some(tool => tool.name === 'create_document_file')).toBe(false)
    expect(getCanonicalCapabilityTool('search_knowledge_catalog')?.parameters).toBeTruthy()
    expect(getCanonicalCapabilityTool('create_document_file')?.parameters).toBeTruthy()
  })

  it('requires index -> guide -> contract and then exposes canonical tool names directly', async () => {
    let session = await startControllerCapabilitySession({ client: null, query: 'ZCRM_COST-111', topK: 10 })
    session = await discoverMoreForController({ client: null, query: 'index', limit: 4, session })
    expect(session.lastDisclosure.layer).toBe('index')
    expect(session.surface.toolNames).not.toContain('get_message_detail')

    session = await discoverMoreForController({
      client: null,
      query: 'guide:search_knowledge_catalog,get_message_detail',
      limit: 4,
      session,
    })
    expect(session.lastDisclosure.layer).toBe('guide')
    expect(session.guidedToolNames).toEqual(['search_knowledge_catalog', 'get_message_detail'])
    expect(session.surface.toolNames).not.toContain('get_message_detail')

    session = await discoverMoreForController({
      client: null,
      query: 'contract:search_knowledge_catalog,get_message_detail',
      limit: 4,
      session,
    })
    expect(session.lastDisclosure.layer).toBe('contract')
    expect(session.activatedToolNames).toEqual(['search_knowledge_catalog', 'get_message_detail'])
    expect(session.surface.toolNames).toContain('search_knowledge_catalog')
    expect(session.surface.toolNames).toContain('get_message_detail')
    expect(session.surface.tools.find(tool => tool.name === 'get_message_detail')?.parameters).toEqual(
      getCanonicalCapabilityTool('get_message_detail')?.parameters,
    )
  })

  it('refuses Layer-3 activation for a capability whose Layer-2 guide was not loaded', async () => {
    let session = await startControllerCapabilitySession({ client: null, query: 'test' })
    session = await discoverMoreForController({ client: null, query: 'index', limit: 4, session })
    session = await discoverMoreForController({ client: null, query: 'contract:get_message_detail', limit: 4, session })
    expect(session.lastDisclosure.layer).toBe('error')
    expect(session.surface.toolNames).not.toContain('get_message_detail')
  })

  it('keeps semantic authority in the active controller model', async () => {
    const session = await startControllerCapabilitySession({ client: null, query: 'test' })
    const observation = capabilitySessionObservation(session)
    expect(observation.logicalCapabilityCount).toBe(33)
    expect(observation.instruction).toContain('sole semantic Controller')
    expect(observation.instruction).toContain('query="index"')
    expect(observation.instruction).toContain('query="guide:name1,name2"')
    expect(observation.instruction).toContain('query="contract:name1,name2"')
    expect(observation.instruction).toContain('canonical tool itself')
    expect(observation.instruction).toContain('options, never mandatory next steps')
  })
})
