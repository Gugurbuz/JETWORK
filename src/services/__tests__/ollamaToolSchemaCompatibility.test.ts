import { describe, expect, it } from 'vitest'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
  OLLAMA_CONTROLLER_CONTEXT_TOKENS,
  OLLAMA_TOOL_DESCRIPTION_MAX_CHARACTERS,
  compactOllamaArgumentSignature,
  normalizeOllamaToolParameters,
  toOllamaTools,
} from '../../../supabase/functions/_shared/ollamaProvider.ts'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

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

  it('keeps all Controller V3 tools while replacing heavy provider schemas with signature contracts', () => {
    const canonical = buildControllerCapabilitySurface().tools as unknown as ReadonlyArray<Record<string, unknown>>
    const ollamaTools = toOllamaTools(canonical)

    expect(canonical.length).toBeGreaterThan(30)
    expect(ollamaTools).toHaveLength(canonical.length)

    for (const tool of ollamaTools) {
      const fn = tool.function as Record<string, unknown>
      expect(fn.parameters).toEqual({ type: 'object' })
      expect(String(fn.description || '').length).toBeLessThanOrEqual(OLLAMA_TOOL_DESCRIPTION_MAX_CHARACTERS)
    }

    const canonicalChars = JSON.stringify(canonicalProviderShape(canonical)).length
    const ollamaChars = JSON.stringify(ollamaTools).length
    expect(ollamaChars).toBeLessThan(canonicalChars * 0.4)

    const byName = new Map(ollamaTools.map(tool => {
      const fn = tool.function as Record<string, unknown>
      return [String(fn.name || ''), String(fn.description || '')]
    }))

    expect(byName.get('get_related_objects')).toContain('canonicalKey')
    expect(byName.get('get_related_objects')).toContain('direction')
    expect(byName.get('edit_spreadsheet_file')).toContain('actions:[{operation,target,value,number}]')
    expect(byName.get('review_evidence_coverage')).toContain('evidenceIds')

    const names = [...byName.keys()]
    expect(names).toContain('list_spreadsheet_attachments')
    expect(names).toContain('list_action_attachments')
    expect(names).toContain('search_knowledge_catalog')
    expect(names).toContain('report_progress')
  })
})
