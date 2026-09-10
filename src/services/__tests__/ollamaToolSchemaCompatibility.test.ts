import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  getCanonicalCapabilityTool,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
  OLLAMA_CONTROLLER_CONTEXT_TOKENS,
  OLLAMA_TOOL_DISPATCHER_NAME,
  buildOllamaDispatcherCatalog,
  compactOllamaArgumentSignature,
  normalizeOllamaToolParameters,
  toOllamaTools,
  unwrapOllamaToolCall,
} from '../../../supabase/functions/_shared/ollamaProvider.ts'

const canonicalProviderShape = (tools: ReadonlyArray<Record<string, unknown>>) => tools.map(tool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}))

describe('Ollama tool schema compatibility', () => {
  it('keeps enough context headroom for the Controller prompt', () => {
    expect(OLLAMA_CONTROLLER_CONTEXT_TOKENS).toBeGreaterThanOrEqual(16_384)
  })

  it('retains the compatibility normalizer for direct schema callers', () => {
    const normalized = normalizeOllamaToolParameters({
      type: 'object',
      description: 'verbose root description',
      properties: {
        mode: { type: 'string', enum: ['exact', 'search'], description: 'verbose', minLength: 1, maxLength: 2_000 },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: 20 },
      },
      required: ['mode', 'limit'],
      additionalProperties: false,
    })

    expect(normalized).toEqual({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['exact', 'search'] },
        limit: { type: ['integer', 'null'] },
      },
      required: ['mode', 'limit'],
    })
  })

  it('renders a compact argument signature from canonical top-level fields', () => {
    expect(compactOllamaArgumentSignature('sample', {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: ['integer', 'null'] },
        mode: { type: 'string', enum: ['exact', 'search'] },
      },
      required: ['query', 'limit'],
    })).toBe('query:string, limit:integer|null, mode?:string=exact|search')
  })

  it('keeps every Controller V5 capability logically available while initial physical grammar stays compact', () => {
    const surface = buildControllerCapabilitySurface()
    const physical = surface.tools as unknown as ReadonlyArray<Record<string, unknown>>
    const ollamaTools = toOllamaTools(physical)

    expect(surface.logicalToolNames.length).toBeGreaterThan(30)
    expect(surface.logicalToolNames).toContain('search_knowledge_catalog')
    expect(surface.logicalToolNames).toContain('get_related_objects')
    expect(physical.map(tool => String(tool.name || ''))).toEqual([
      'report_progress',
      'discover_more_capabilities',
      'execute_capabilities',
      'request_large_context',
    ])
    expect(ollamaTools).toHaveLength(1)

    const dispatcher = ollamaTools[0].function as Record<string, unknown>
    expect(dispatcher.name).toBe(OLLAMA_TOOL_DISPATCHER_NAME)

    const parameters = dispatcher.parameters as {
      properties: { name: { enum: string[] }; arguments_json: { type: string } }
      required: string[]
    }
    const physicalNames = physical.map(tool => String(tool.name || ''))
    expect(parameters.properties.name.enum).toEqual(physicalNames)
    expect(parameters.properties.arguments_json.type).toBe('string')
    expect(parameters.required).toEqual(['name', 'arguments_json'])

    const catalog = buildOllamaDispatcherCatalog(physical)
    for (const name of physicalNames) expect(catalog).toContain(name)
    expect(catalog).toContain('report_progress')
    expect(catalog).toContain('execute_capabilities')

    const allCanonical = surface.logicalToolNames
      .map(name => getCanonicalCapabilityTool(name))
      .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool)) as unknown as ReadonlyArray<Record<string, unknown>>
    const fullCanonicalChars = JSON.stringify(canonicalProviderShape(allCanonical)).length
    const ollamaChars = JSON.stringify(ollamaTools).length
    expect(ollamaChars).toBeLessThan(fullCanonicalChars * 0.3)
  })

  it('unwraps one dispatcher call back to the canonical JetWork function call', () => {
    const allowed = new Set(['search_knowledge_catalog', 'report_progress'])
    const unwrapped = unwrapOllamaToolCall({
      function: {
        name: OLLAMA_TOOL_DISPATCHER_NAME,
        arguments: {
          name: 'search_knowledge_catalog',
          arguments_json: JSON.stringify({ query: 'ZCRM_COST-111', limit: 5 }),
        },
      },
    }, allowed)

    expect(unwrapped).toEqual({
      name: 'search_knowledge_catalog',
      arguments: { query: 'ZCRM_COST-111', limit: 5 },
    })
  })

  it('rejects invented dispatcher targets while tolerating an in-flight legacy direct call', () => {
    const allowed = new Set(['search_knowledge_catalog'])
    expect(unwrapOllamaToolCall({
      function: {
        name: OLLAMA_TOOL_DISPATCHER_NAME,
        arguments: { name: 'invented_tool', arguments_json: '{}' },
      },
    }, allowed)).toBeNull()

    expect(unwrapOllamaToolCall({
      function: {
        name: 'search_knowledge_catalog',
        arguments: { query: '111' },
      },
    }, allowed)).toEqual({
      name: 'search_knowledge_catalog',
      arguments: { query: '111' },
    })
  })

  it('supports the Controller V5 pre-plan gate with report_progress still directly available', () => {
    const physical = buildControllerCapabilitySurface().tools as unknown as ReadonlyArray<Record<string, unknown>>
    const reportProgress = physical.filter(tool => tool.name === 'report_progress')
    const ollamaTools = toOllamaTools(reportProgress)
    const dispatcher = ollamaTools[0].function as Record<string, unknown>
    const parameters = dispatcher.parameters as { properties: { name: { enum: string[] } } }

    expect(ollamaTools).toHaveLength(1)
    expect(parameters.properties.name.enum).toEqual(['report_progress'])
    expect(String(dispatcher.description || '')).toContain('resolvedGoal')
    expect(String(dispatcher.description || '')).toContain('planSteps')
  })
})
