import { describe, expect, it } from 'vitest'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
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
  if (typeof value.maxLength === 'number' && value.maxLength >= 2_000) {
    hazards.push(`${path}: maxLength ${value.maxLength}`)
  }

  return [
    ...hazards,
    ...Object.entries(value).flatMap(([key, nested]) => grammarHazards(nested, `${path}.${key}`)),
  ]
}

describe('Ollama tool schema compatibility', () => {
  it('removes the llama.cpp zero-property object grammar hazard without removing the tool', () => {
    const normalized = normalizeOllamaToolParameters({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    })

    expect(normalized).toEqual({ type: 'object' })
  })

  it('drops grammar-unsafe maxLength constraints at or above the llama.cpp repetition threshold', () => {
    const normalized = normalizeOllamaToolParameters({
      type: 'object',
      properties: {
        compact: { type: 'string', maxLength: 500 },
        boundary: { type: 'string', minLength: 1, maxLength: 2_000 },
        large: { type: 'string', minLength: 1, maxLength: 24_000 },
      },
      required: ['compact', 'boundary', 'large'],
      additionalProperties: false,
    })

    const properties = normalized.properties as Record<string, Record<string, unknown>>
    expect(properties.compact.maxLength).toBe(500)
    expect(properties.boundary.minLength).toBe(1)
    expect(properties.boundary).not.toHaveProperty('maxLength')
    expect(properties.large.minLength).toBe(1)
    expect(properties.large).not.toHaveProperty('maxLength')
  })

  it('keeps the complete Controller V3 tool surface intact and grammar-safe', () => {
    const canonical = buildControllerCapabilitySurface().tools as unknown as ReadonlyArray<Record<string, unknown>>
    const ollamaTools = toOllamaTools(canonical)

    expect(canonical.length).toBeGreaterThan(30)
    expect(ollamaTools).toHaveLength(canonical.length)
    expect(grammarHazards(ollamaTools)).toEqual([])

    const names = ollamaTools.map(tool => String((tool.function as Record<string, unknown>)?.name || ''))
    expect(names).toContain('list_spreadsheet_attachments')
    expect(names).toContain('list_action_attachments')
    expect(names).toContain('search_knowledge_catalog')
    expect(names).toContain('report_progress')
  })
})
