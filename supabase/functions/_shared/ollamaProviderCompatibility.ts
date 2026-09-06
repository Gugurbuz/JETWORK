import {
  requestOllamaResponse as baseRequestOllamaResponse,
  type OllamaNormalizedResponse,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/b013277a9d89f5d6a7f4fee28f552541e1246e50/supabase/functions/_shared/ollamaProvider.ts?ollama-compat-base=1'

export {
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_MODELS,
  OLLAMA_MODEL_PREFIX,
  isOllamaModel,
  ollamaExecutionModel,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/b013277a9d89f5d6a7f4fee28f552541e1246e50/supabase/functions/_shared/ollamaProvider.ts?ollama-compat-base=1'
export type { OllamaNormalizedResponse } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/b013277a9d89f5d6a7f4fee28f552541e1246e50/supabase/functions/_shared/ollamaProvider.ts?ollama-compat-base=1'

type OllamaRequestInput = {
  gatewayUrl: string
  gatewayToken: string
  model: string
  instructions: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  maxOutputTokens: number
  maxContextCharacters?: number
  onText: (text: string) => void
  signal?: AbortSignal
}

const clean = (value: unknown) => String(value ?? '').trim()

const MEMORY_BLOCK_PATTERN = /\[JETWORK_CONVERSATIONAL_MEMORY_NOT_EVIDENCE\]\s*(?:Bu içerik yalnız konuşma sürekliliği içindir; kurumsal\/teknik fact veya citation değildir\.\s*)?([\s\S]*?)\s*\[END_JETWORK_CONVERSATIONAL_MEMORY_NOT_EVIDENCE\]/giu
const MEMORY_MARKER_PATTERN = /\[(?:END_)?JETWORK_CONVERSATIONAL_MEMORY_NOT_EVIDENCE\]/giu

const sanitizeInternalMemoryText = (value: string) => value
  .replace(MEMORY_BLOCK_PATTERN, (_match, payload) => String(payload || '').trim())
  .replace(MEMORY_MARKER_PATTERN, '')
  .replace(/^Bu içerik yalnız konuşma sürekliliği içindir; kurumsal\/teknik fact veya citation değildir\.\s*$/gimu, '')
  .trim()

const sanitizeInternalMarkers = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeInternalMemoryText(value)
  if (Array.isArray(value)) return value.map(sanitizeInternalMarkers)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sanitizeInternalMarkers(nested)]),
  )
}

const preferredNonNullType = (value: unknown) => {
  if (!Array.isArray(value)) return clean(value) || undefined
  const types = value.map(clean).filter(Boolean)
  return types.find(type => type !== 'null') || types[0] || 'string'
}

const normalizeEnum = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter(item => item !== null && ['string', 'number', 'boolean'].includes(typeof item))
  return filtered.length ? filtered.slice(0, 48) : undefined
}

const BASIC_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'])

/**
 * Keep only the minimal JSON Schema surface Ollama needs for function calling.
 * Descriptions and validation-only constraints are intentionally omitted from
 * nested parameter schemas because llama.cpp includes the whole tool grammar in
 * the model context and JetWork's strict schemas can otherwise exceed 4k tokens.
 */
export const normalizeOllamaToolSchema = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const source = value as Record<string, unknown>
  const rawType = preferredNonNullType(source.type)
  const type = rawType && BASIC_SCHEMA_TYPES.has(rawType) ? rawType : undefined
  const result: Record<string, unknown> = {}

  if (type) result.type = type

  const enumValues = normalizeEnum(source.enum)
  if (enumValues) result.enum = enumValues

  if (type === 'object' || source.properties) {
    const sourceProperties = source.properties && typeof source.properties === 'object' && !Array.isArray(source.properties)
      ? source.properties as Record<string, unknown>
      : {}
    const properties = Object.fromEntries(
      Object.entries(sourceProperties).map(([key, schema]) => [key, normalizeOllamaToolSchema(schema)]),
    )
    result.type = 'object'
    result.properties = properties

    if (Array.isArray(source.required)) {
      const required = source.required.map(clean).filter(key => key && Object.hasOwn(properties, key))
      if (required.length) result.required = required
    }
  } else if (type === 'array') {
    result.items = normalizeOllamaToolSchema(
      source.items && typeof source.items === 'object' ? source.items : { type: 'string' },
    )
  }

  if (!result.type) result.type = 'string'
  return result
}

const normalizeOllamaTools = (tools: ReadonlyArray<Record<string, unknown>>) => tools.flatMap(tool => {
  if (clean(tool.type) !== 'function') return []
  const name = clean(tool.name)
  if (!name) return []
  return [{
    type: 'function',
    name,
    description: clean(tool.description).slice(0, 160),
    parameters: normalizeOllamaToolSchema(
      tool.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', properties: {} },
    ),
  }]
})

const errorText = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error ?? '')
}

const isToolGrammarError = (error: unknown) => (
  /failed to initialize samplers|failed to parse grammar|grammar.*parse/i.test(errorText(error))
)

const isContextSizeError = (error: unknown) => (
  /exceeds the available context size|exceed_context_size_error|n_ctx/i.test(errorText(error))
)

const positiveIntegerEnv = (name: string, fallback: number) => {
  const parsed = Number(Deno.env.get(name))
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

// This is intentionally capacity-only, not semantic routing. If the complete
// tool grammar cannot fit in the configured local context, sending it is a
// guaranteed 400 from llama.cpp. Skip that doomed first request and preserve
// the existing tools-off fallback behavior without adding prompt-specific rules.
const toolContextPreflight = (
  input: OllamaRequestInput,
  tools: ReadonlyArray<Record<string, unknown>>,
) => {
  if (!input.allowTools || !tools.length) return { skip: false, estimatedTokens: 0, contextTokens: 0 }

  const sanitizedItems = sanitizeInternalMarkers(input.items)
  const serialized = JSON.stringify({
    instructions: sanitizeInternalMemoryText(input.instructions),
    input: sanitizedItems,
    tools,
  })

  // JSON/tool payloads are token-dense. Three UTF-16 characters per token is a
  // conservative estimate for this preflight; leave headroom for chat-template
  // control tokens that are added by Ollama/llama.cpp after serialization.
  const estimatedTokens = Math.ceil(serialized.length / 3)
  const contextTokens = positiveIntegerEnv('OLLAMA_CONTEXT_TOKENS', 4096)
  const safePromptBudget = Math.floor(contextTokens * 0.86)

  return {
    skip: estimatedTokens >= safePromptBudget,
    estimatedTokens,
    contextTokens,
  }
}

const withUsage = (
  response: OllamaNormalizedResponse,
  extra: Record<string, number>,
): OllamaNormalizedResponse => ({
  ...response,
  usage: {
    ...((response.usage && typeof response.usage === 'object') ? response.usage : {}),
    ...extra,
  },
})

const sanitizedResponse = (response: OllamaNormalizedResponse): OllamaNormalizedResponse => (
  sanitizeInternalMarkers(response) as OllamaNormalizedResponse
)

const responseVisibleText = (response: OllamaNormalizedResponse) => {
  const output = Array.isArray(response.output) ? response.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content as Array<Record<string, unknown>>) {
      if ((part?.type === 'output_text' || part?.type === 'refusal') && typeof part.text === 'string') {
        chunks.push(part.text)
      }
    }
  }
  return chunks.join('')
}

const runBuffered = async (
  input: OllamaRequestInput,
  overrides: Partial<Pick<OllamaRequestInput, 'items' | 'tools' | 'allowTools'>>,
) => {
  const response = await baseRequestOllamaResponse({
    ...input,
    ...overrides,
    items: (sanitizeInternalMarkers(overrides.items ?? input.items) as Array<Record<string, unknown>>),
    instructions: sanitizeInternalMemoryText(input.instructions),
    onText: () => {},
  })
  const cleanResponse = sanitizedResponse(response)
  const text = responseVisibleText(cleanResponse)
  if (text) input.onText(text)
  return cleanResponse
}

export async function requestOllamaResponse(input: OllamaRequestInput): Promise<OllamaNormalizedResponse> {
  const normalizedTools = input.allowTools ? normalizeOllamaTools(input.tools) : input.tools
  const preflight = toolContextPreflight(input, normalizedTools)

  if (preflight.skip) {
    console.warn('OLLAMA_TOOL_CONTEXT_PREFLIGHT_SKIP', JSON.stringify({
      model: input.model,
      toolCount: normalizedTools.length,
      estimatedTokens: preflight.estimatedTokens,
      contextTokens: preflight.contextTokens,
    }))

    const response = await runBuffered(input, {
      tools: [],
      allowTools: false,
    })

    return withUsage(response, {
      ollama_tool_schema_compat: 1,
      ollama_tool_context_preflight_skip: 1,
      ollama_internal_marker_sanitizer: 1,
    })
  }

  try {
    const response = await runBuffered(input, { tools: normalizedTools })
    return withUsage(response, {
      ollama_tool_schema_compat: input.allowTools && input.tools.length ? 1 : 0,
      ollama_internal_marker_sanitizer: 1,
    })
  } catch (error) {
    const grammarError = isToolGrammarError(error)
    const contextError = isContextSizeError(error)
    if (input.signal?.aborted || !input.allowTools || !input.tools.length || (!grammarError && !contextError)) {
      throw error
    }

    console.warn('OLLAMA_TOOL_RETRY_WITHOUT_TOOLS', JSON.stringify({
      model: input.model,
      toolCount: input.tools.length,
      reason: grammarError ? 'grammar' : 'context_size',
      error: errorText(error).slice(0, 500),
    }))

    const response = await runBuffered(input, {
      tools: [],
      allowTools: false,
    })

    return withUsage(response, {
      ollama_tool_schema_compat: 1,
      ...(grammarError ? { ollama_tool_grammar_retry_without_tools: 1 } : {}),
      ...(contextError ? { ollama_context_retry_without_tools: 1 } : {}),
      ollama_internal_marker_sanitizer: 1,
    })
  }
}
