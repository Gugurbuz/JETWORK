import {
  isOllamaModel,
  requestOllamaResponse,
  type OllamaNormalizedResponse,
} from './ollamaProvider.ts'

const OPENAI_RESPONSES_HOST = 'api.openai.com'
const OPENAI_RESPONSES_PATH = '/v1/responses'

const clean = (value: unknown) => String(value ?? '').trim()

const boundedIntegerEnv = (name: string, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(Deno.env.get(name))
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(Math.trunc(parsed), maximum))
}

const requestUrl = (input: Parameters<typeof fetch>[0]) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const requestMethod = (input: Parameters<typeof fetch>[0], init?: RequestInit) => (
  clean(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() || 'GET'
)

const parseJsonBody = (init?: RequestInit): Record<string, unknown> | null => {
  if (typeof init?.body !== 'string') return null
  try {
    const parsed = JSON.parse(init.body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const isResponsesRequest = (input: Parameters<typeof fetch>[0]) => {
  try {
    const url = new URL(requestUrl(input))
    return url.hostname === OPENAI_RESPONSES_HOST && url.pathname === OPENAI_RESPONSES_PATH
  } catch {
    return false
  }
}

const responseText = (response: OllamaNormalizedResponse) => {
  const output = Array.isArray(response.output) ? response.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content as Array<Record<string, unknown>>) {
      if ((part.type === 'output_text' || part.type === 'refusal') && typeof part.text === 'string') {
        chunks.push(part.text)
      }
    }
  }
  return chunks.join('')
}

const completedPayload = (response: OllamaNormalizedResponse) => ({
  id: response.id || `ollama:${crypto.randomUUID()}`,
  status: response.status || 'completed',
  model: response.model,
  output: response.output || [],
  usage: response.usage || {},
  error: response.error,
  incomplete_details: response.incomplete_details,
})

const streamingResponse = (response: OllamaNormalizedResponse) => {
  const completed = completedPayload(response)
  const text = responseText(response)
  const frames: string[] = []
  if (text) {
    frames.push(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`)
  }
  frames.push(`data: ${JSON.stringify({ type: 'response.completed', response: completed })}\n\n`)
  frames.push('data: [DONE]\n\n')
  return new Response(frames.join(''), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-JetWork-Provider-Bridge': 'ollama-v1',
    },
  })
}

const jsonResponse = (response: OllamaNormalizedResponse) => new Response(
  JSON.stringify(completedPayload(response)),
  {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-JetWork-Provider-Bridge': 'ollama-v1',
    },
  },
)

export function createOllamaResponsesBridge(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!isResponsesRequest(input) || requestMethod(input, init) !== 'POST') {
      return baseFetch(input, init)
    }

    const body = parseJsonBody(init)
    const model = clean(body?.model)
    if (!body || !isOllamaModel(model)) return baseFetch(input, init)

    const gatewayUrl = clean(Deno.env.get('OLLAMA_GATEWAY_URL'))
    const gatewayToken = clean(
      Deno.env.get('JETWORK_OLLAMA_GATEWAY_TOKEN')
      || Deno.env.get('OLLAMA_GATEWAY_TOKEN'),
    )
    if (!gatewayUrl || !gatewayToken) {
      throw new Error('JetWork Ollama gateway secrets are not configured.')
    }

    const items = Array.isArray(body.input)
      ? body.input.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>
      : []
    const tools = Array.isArray(body.tools)
      ? body.tools.filter(tool => tool && typeof tool === 'object') as Array<Record<string, unknown>>
      : []
    const requestedMaxOutput = Number(body.max_output_tokens || 0)
    const maxOutputTokens = Number.isFinite(requestedMaxOutput) && requestedMaxOutput > 0
      ? Math.trunc(requestedMaxOutput)
      : 900

    const response = await requestOllamaResponse({
      gatewayUrl,
      gatewayToken,
      model,
      instructions: clean(body.instructions),
      items,
      tools,
      allowTools: tools.some(tool => clean(tool.type) === 'function'),
      maxOutputTokens,
      maxContextCharacters: boundedIntegerEnv('OLLAMA_MAX_CONTEXT_CHARACTERS', 5_000, 2_500, 20_000),
      onText: () => {},
      signal: init?.signal || undefined,
    })

    console.info('OLLAMA_RESPONSES_BRIDGE', JSON.stringify({
      model,
      inputTokens: Number(response.usage?.input_tokens || 0),
      outputTokens: Number(response.usage?.output_tokens || 0),
      providerMs: Number(response.usage?.ollama_provider_total_ms || 0),
      modelMs: Number(response.usage?.ollama_model_total_ms || 0),
      toolCalls: Number(response.usage?.ollama_tool_calls || 0),
    }))

    return body.stream === true ? streamingResponse(response) : jsonResponse(response)
  }
}

let installed = false

export function installOllamaResponsesBridge(): void {
  if (installed) return
  globalThis.fetch = createOllamaResponsesBridge(globalThis.fetch.bind(globalThis))
  installed = true
}
