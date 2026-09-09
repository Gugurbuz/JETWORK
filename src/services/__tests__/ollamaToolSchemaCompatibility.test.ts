import { describe, expect, it } from 'vitest'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
  OLLAMA_CONTROLLER_CONTEXT_TOKENS,
  OLLAMA_TOOL_DESCRIPTION_MAX_CHARACTERS,
  normalizeOllamaToolParameters,
  toOllamaTools,
} from '../../../supabase/functions/_shared/ollamaProvider.ts'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const grammarHazards = (value: unknown, path = '$'): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => grammarHazards(item, `${path}[${index}]`))
  }
  if (!isRecord(value)) return []

  const hazards: string[] = []
  if (
    value.type === 'object'
    && isRecord(value.properties)
    && Object.keys(value.properties).length === 0
  ) {
    hazards.push(`${path}: empty object properties`)
  }
  if ('maxLength' in value) hazards.push(`${path}: maxLength retained`)

  return [
    ...hazards,
    ...Object.entries(value).flatMap(([key, nested]) => grammarHazards(nested, `${path}.${key}`)),
  ]
}

const canonicalProviderShape = (tools: ReadonlyArray<Record<string, unknown>>) => tools.map(tool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}))

describe('Ollama tool schema compatibility', () => {
  it('keeps enough context headroom for the Controller prompt plus full tool surface', () => {
    expect(OLLAMA_CONTROLLER_CONTEXT_TOKENS).toBeGreaterThanOrEqual(16_384)
  })

  it('removes zero-property object grammar hazards without removing the tool', () => {
    const normalized = normalizeOllamaToolParameters({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    })

    expect(normalized).toEqual({ type: 'object' })
  })

  it('drops provider-redundant validation metadata while retaining structure and enums', () => {
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

  it('keeps the complete Controller V3 tool surface intact, compact and grammar-safe', () => {
    const canonical = buildControllerCapabilitySurface().tools as unknown as ReadonlyArray<Record<string, unknown>>
    const ollamaTools = toOllamaTools(canonical)

    expect(canonical.length).toBeGreaterThan(30)
    expect(ollamaTools).toHaveLength(canonical.length)
    expect(grammarHazards(ollamaTools)).toEqual([])

    const canonicalChars = JSON.stringify(canonicalProviderShape(canonical)).length
    const ollamaChars = JSON.stringify(ollamaTools).length
    expect(ollamaChars).toBeLessThan(canonicalChars * 0.8)

    for (const tool of ollamaTools) {
      const fn = tool.function as Record<string, unknown>
      expect(String(fn.description || '').length).toBeLessThanOrEqual(OLLAMA_TOOL_DESCRIPTION_MAX_CHARACTERS)
    }

    const names = ollamaTools.map(tool => String((tool.function as Record<string, unknown>)?.name || ''))
    expect(names).toContain('list_spreadsheet_attachments')
    expect(names).toContain('list_action_attachments')
    expect(names).toContain('search_knowledge_catalog')
    expect(names).toContain('report_progress')
  })
})
