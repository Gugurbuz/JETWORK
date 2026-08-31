export const OLLAMA_MODEL_PREFIX = 'ollama:'
export const DEFAULT_OLLAMA_MODEL = 'ollama:qwen3:4b-instruct'
export const OLLAMA_MODELS = new Set([DEFAULT_OLLAMA_MODEL])

export type OllamaNormalizedResponse = {
  id?: string
  status?: string
  model?: string
  output?: Array<Record<string, unknown>>
  usage?: Record<string, number>
  error?: { message?: string }
  incomplete_details?: { reason?: string }
}

const clean = (value: unknown) => String(value ?? '').trim()

export const isOllamaModel = (model: string) => OLLAMA_MODELS.has(clean(model))

export const ollamaExecutionModel = (model: string) => {
  const normalized = clean(model)
  if (!normalized.startsWith(OLLAMA_MODEL_PREFIX)) return normalized
  return normalized.slice(OLLAMA_MODEL_PREFIX.length)
}

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const candidate = part as Record<string, unknown>
    return typeof candidate.text === 'string' ? candidate.text : ''
  }).filter(Boolean).join('\n')
}

const compactText = (value: string, maxCharacters: number) => {
  if (value.length <= maxCharacters) return value
  const head = Math.floor(maxCharacters * 0.45)
  const tail = Math.max(0, maxCharacters - head)
  return `${value.slice(0, head)}\n[...JetWork local context compacted...]\n${value.slice(-tail)}`
}

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_name?: string
  tool_calls?: Array<{
    type: 'function'
    function: { name: string; arguments: Record<string, unknown> }
  }>
}

const parseArguments = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

const toOllamaMessages = (
  instructions: string,
  items: Array<Record<string, unknown>>,
  maxContextCharacters: number,
): OllamaMessage[] => {
  const callNames = new Map<string, string>()
  const converted: OllamaMessage[] = []
  const systemParts = [instructions]

  for (const item of items) {
    const type = clean(item.type)
    const role = clean(item.role)
    if (role === 'developer' || role === 'system') {
      const text = textFromContent(item.content)
      if (text) systemParts.push(text)
      continue
    }
    if (!type && (role === 'user' || role === 'assistant')) {
      const content = textFromContent(item.content)
      if (content) converted.push({ role: role as 'user' | 'assistant', content })
      continue
    }
    if (type === 'message') {
      const content = textFromContent(item.content)
      if (content) converted.push({ role: role === 'user' ? 'user' : 'assistant', content })
      continue
    }
    if (type === 'function_call') {
      const callId = clean(item.call_id)
      const name = clean(item.name)
      if (callId) callNames.set(callId, name)
      if (name) {
        converted.push({
          role: 'assistant',
          content: '',
          tool_calls: [{
            type: 'function',
            function: { name, arguments: parseArguments(item.arguments) },
          }],
        })
      }
      continue
    }
    if (type === 'function_call_output') {
      const callId = clean(item.call_id)
      const name = callNames.get(callId) || 'knowledge_tool'
      const content = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
      converted.push({ role: 'tool', tool_name: name, content })
    }
  }

  const systemBudget = Math.min(6_000, Math.max(2_000, Math.floor(maxContextCharacters * 0.4)))
  const messages: OllamaMessage[] = [{
    role: 'system',
    content: compactText(systemParts.filter(Boolean).join('\n\n'), systemBudget),
  }]
  let remaining = Math.max(2_000, maxContextCharacters - (messages[0].content?.length || 0))
  const recent: OllamaMessage[] = []

  for (let index = converted.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = converted[index]
    const content = message.content || ''
    const allowance = Math.min(6_000, remaining)
    const compacted = compactText(content, allowance)
    recent.unshift({ ...message, content: compacted })
    remaining -= compacted.length
  }

  return [...messages, ...recent]
}

const toOllamaTools = (tools: ReadonlyArray<Record<string, unknown>>) => tools.flatMap(tool => {
  if (clean(tool.type) !== 'function') return []
  const name = clean(tool.name)
  if (!name) return []
  return [{
    type: 'function',
    function: {
      name,
      description: clean(tool.description),
      parameters: tool.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', properties: {} },
    },
  }]
})

const durationMs = (value: unknown) => {
  const nanoseconds = Number(value || 0)
  return Number.isFinite(nanoseconds) && nanoseconds > 0 ? Math.round(nanoseconds / 1_000_000) : 0
}

export async function requestOllamaResponse(input: {
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
}): Promise<OllamaNormalizedResponse> {
  const gatewayUrl = clean(input.gatewayUrl).replace(/\/$/, '')
  const gatewayToken = clean(input.gatewayToken)
  if (!/^https:\/\//i.test(gatewayUrl)) throw new Error('OLLAMA_GATEWAY_URL must be an HTTPS URL.')
  if (gatewayToken.length < 24) throw new Error('OLLAMA_GATEWAY_TOKEN is not configured.')
  if (!isOllamaModel(input.model)) throw new Error(`Unsupported Ollama model: ${input.model}`)

  const model = ollamaExecutionModel(input.model)
  const tools = input.allowTools ? toOllamaTools(input.tools) : []
  const requestStartedAt = performance.now()
  const response = await fetch(`${gatewayUrl}/api/chat`, {
    method: 'POST',
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: toOllamaMessages(input.instructions, input.items, input.maxContextCharacters ?? 14_000),
      ...(tools.length ? { tools } : {}),
      think: false,
      stream: false,
      options: {
        num_ctx: 4096,
        num_predict: Math.max(64, Math.min(input.maxOutputTokens, 1_200)),
      },
    }),
  })

  const payload = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) {
    const detail = clean(payload?.error || payload?.message).slice(0, 1_000)
    throw new Error(detail || `Ollama gateway returned ${response.status}.`)
  }

  const message = payload?.message && typeof payload.message === 'object' ? payload.message : {}
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const visibleText = clean(message.content)
  const output: Array<Record<string, unknown>> = toolCalls.length
    ? toolCalls.flatMap((call: any) => {
        const name = clean(call?.function?.name)
        if (!name) return []
        const args = parseArguments(call?.function?.arguments)
        return [{
          type: 'function_call',
          call_id: `ollama:${crypto.randomUUID()}`,
          name,
          arguments: JSON.stringify(args),
        }]
      })
    : [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: visibleText, annotations: [] }],
      }]

  if (!toolCalls.length && visibleText) input.onText(visibleText)

  const promptTokens = Number(payload.prompt_eval_count || 0)
  const outputTokens = Number(payload.eval_count || 0)
  const providerTotalMs = Math.max(0, Math.round(performance.now() - requestStartedAt))
  return {
    id: `ollama:${crypto.randomUUID()}`,
    status: 'completed',
    model: input.model,
    output,
    usage: {
      input_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
      output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
      total_tokens: (Number.isFinite(promptTokens) ? promptTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : 0),
      ollama_provider_total_ms: providerTotalMs,
      ollama_model_total_ms: durationMs(payload.total_duration),
      ollama_load_ms: durationMs(payload.load_duration),
      ollama_prompt_eval_ms: durationMs(payload.prompt_eval_duration),
      ollama_eval_ms: durationMs(payload.eval_duration),
      ollama_tool_calls: toolCalls.length,
    },
  }
}
