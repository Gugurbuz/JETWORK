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

const SCHEMA_META_KEYS = new Set([
  '$schema',
  '$id',
  '$anchor',
  '$dynamicAnchor',
  '$comment',
])

const preferredNonNullType = (value: unknown) => {
  if (!Array.isArray(value)) return value
  const types = value.map(clean).filter(Boolean)
  return types.find(type => type !== 'null') || types[0] || 'string'
}

const normalizeEnum = (value: unknown, normalizedType: unknown) => {
  if (!Array.isArray(value)) return value
  if (normalizedType === 'null') return value
  const filtered = value.filter(item => item !== null)
  return filtered.length ? filtered : value
}

/**
 * Ollama/llama.cpp tool grammars currently accept a narrower JSON Schema
 * surface than JetWork's OpenAI/Gemini strict tools. In particular, nullable
 * type unions such as ["integer", "null"] can make sampler grammar creation
 * fail before the model receives the prompt.
 *
 * Keep the semantic shape of the tool, but collapse nullable type unions to
 * their non-null type and remove schema-only metadata that is irrelevant to
 * tool argument generation.
 */
export const normalizeOllamaToolSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeOllamaToolSchema)
  if (!value || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  const normalizedType = preferredNonNullType(source.type)
  const result: Record<string, unknown> = {}

  for (const [key, nested] of Object.entries(source)) {
    if (SCHEMA_META_KEYS.has(key)) continue
    if (key === 'nullable') continue
    if (key === 'type') {
      result.type = normalizedType
      continue
    }
    if (key === 'enum') {
      result.enum = normalizeEnum(nested, normalizedType)
      continue
    }
    if (key === 'default' && nested === null && normalizedType !== 'null') continue
    result[key] = normalizeOllamaToolSchema(nested)
  }

  return result
}

const normalizeOllamaTools = (tools: ReadonlyArray<Record<string, unknown>>) => tools.map(tool => {
  if (clean(tool.type) !== 'function') return tool
  if (!tool.parameters || typeof tool.parameters !== 'object') return tool
  return {
    ...tool,
    parameters: normalizeOllamaToolSchema(tool.parameters),
  }
})

const errorText = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error ?? '')
}

const isToolGrammarError = (error: unknown) => (
  /failed to initialize samplers|failed to parse grammar|grammar.*parse/i.test(errorText(error))
)

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

export async function requestOllamaResponse(input: OllamaRequestInput): Promise<OllamaNormalizedResponse> {
  const normalizedTools = input.allowTools ? normalizeOllamaTools(input.tools) : input.tools

  try {
    const response = await baseRequestOllamaResponse({
      ...input,
      tools: normalizedTools,
    })
    return withUsage(response, {
      ollama_tool_schema_compat: input.allowTools && input.tools.length ? 1 : 0,
    })
  } catch (error) {
    if (input.signal?.aborted || !input.allowTools || !input.tools.length || !isToolGrammarError(error)) {
      throw error
    }

    console.warn('OLLAMA_TOOL_GRAMMAR_RETRY_WITHOUT_TOOLS', JSON.stringify({
      model: input.model,
      toolCount: input.tools.length,
      error: errorText(error).slice(0, 500),
    }))

    const response = await baseRequestOllamaResponse({
      ...input,
      tools: [],
      allowTools: false,
    })

    return withUsage(response, {
      ollama_tool_schema_compat: 1,
      ollama_tool_grammar_retry_without_tools: 1,
    })
  }
}
