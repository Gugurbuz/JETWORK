import { describe, expect, it } from 'vitest'
import { ASSISTANT_ARTIFACT_TOOLS } from '../../../supabase/functions/_shared/artifactExecutionTools.ts'
import { ASSISTANT_EXECUTION_TOOLS } from '../../../supabase/functions/_shared/executionTools.ts'
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
  if (typeof value.maxLength === 'number' && value.maxLength > 2_000) {
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

  it('drops only oversized grammar-level maxLength constraints', () => {
    const normalized = normalizeOllamaToolParameters({
      type: 'object',
      properties: {
        compact: { type: 'string', maxLength: 500 },
        large: { type: 'string', minLength: 1, maxLength: 24_000 },
      },
      required: ['compact', 'large'],
      additionalProperties: false,
    })

    const properties = normalized.properties as Record<string, Record<string, unknown>>
    expect(properties.compact.maxLength).toBe(500)
    expect(properties.large.minLength).toBe(1)
    expect(properties.large).not.toHaveProperty('maxLength')
  })

  it('keeps the current execution and artifact tool catalog intact and grammar-safe', () => {
    const canonical = [
      ...ASSISTANT_EXECUTION_TOOLS,
      ...ASSISTANT_ARTIFACT_TOOLS,
    ] as unknown as ReadonlyArray<Record<string, unknown>>

    const ollamaTools = toOllamaTools(canonical)
    expect(ollamaTools).toHaveLength(canonical.length)
    expect(grammarHazards(ollamaTools)).toEqual([])

    const names = ollamaTools.map(tool => String((tool.function as Record<string, unknown>)?.name || ''))
    expect(names).toContain('list_spreadsheet_attachments')
    expect(names).toContain('list_action_attachments')
  })
})
