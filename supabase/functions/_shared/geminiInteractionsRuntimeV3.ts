export const GEMINI_INTERACTIONS_MODEL = 'gemini-3.8-flash'
export const GEMINI_PROVIDER_STATE_TYPE = 'jetwork_provider_state'
export const GEMINI_PROVIDER_STATE_VERSION = 'gemini-interaction-state-v1'

export type GeminiInteractionWorkMode = 'fast' | 'balanced' | 'deep'

export interface GeminiInteractionPublicStepEvent {
  lifecycle: 'start' | 'complete'
  operationId: string
  stepType: 'google_search_call' | 'url_context_call' | 'code_execution_call'
  toolFamily: 'web' | 'code'
  failed?: boolean
}

export interface GeminiInteractionsRequest {
  apiKey: string
  model?: string
  systemInstruction: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  allowProviderWeb?: boolean
  workMode?: GeminiInteractionWorkMode
  maxOutputTokens: number
  onText: (text: string) => void
  onStepEvent?: (event: GeminiInteractionPublicStepEvent) => void
  signal?: AbortSignal
}

export interface GeminiInteractionsNormalizedResponse {
  id?: string
  status?: string
  model?: string
  output?: Array<Record<string, unknown>>
  usage?: Record<string, number>
  webSources?: Array<{ title: string; url: string }>
  webSearchQueries?: string[]
  error?: { message?: string }
  incomplete_details?: { reason?: string }
}

export interface GeminiProviderStateItem extends Record<string, unknown> {
  type: typeof GEMINI_PROVIDER_STATE_TYPE
  version: typeof GEMINI_PROVIDER_STATE_VERSION
  provider: 'gemini'
  interaction_id: string
}

export const createGeminiProviderStateItem = (interactionId: string): GeminiProviderStateItem => ({
  type: GEMINI_PROVIDER_STATE_TYPE,
  version: GEMINI_PROVIDER_STATE_VERSION,
  provider: 'gemini',
  interaction_id: String(interactionId || '').trim().slice(0, 500),
})

const INTERNAL_BLOCK_PATTERNS = [
  /\[JETWORK_SEMANTIC_PLAN\][\s\S]*?\[END_JETWORK_SEMANTIC_PLAN\]/gi,
  /\[JETWORK REASONING ENGINE - OPERATIONAL CONTEXT\][\s\S]*?(?=\n\[[A-Z0-9 _-]+\]|$)/gi,
]

const cleanText = (value: unknown, max = 200_000) => {
  let text = String(value ?? '')
  for (const pattern of INTERNAL_BLOCK_PATTERNS) text = text.replace(pattern, '')
  return text.replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

const textFromContent = (content: unknown) => {
  if (typeof content === 'string') return cleanText(content)
  if (!Array.isArray(content)) return ''
  return cleanText(content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const candidate = part as Record<string, unknown>
    if (typeof candidate.text === 'string') return candidate.text
    if (typeof candidate.input_text === 'string') return candidate.input_text
    if (typeof candidate.output_text === 'string') return candidate.output_text
    return ''
  }).filter(Boolean).join('\n'))
}

const parseArguments = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

const functionNamesByCallId = (items: Array<Record<string, unknown>>) => {
  const names = new Map<string, string>()
  for (const item of items) {
    if (String(item.type || '') !== 'function_call') continue
    const callId = String(item.call_id || item.id || '')
    const name = String(item.name || '')
    if (callId && name) names.set(callId, name)
  }
  return names
}

const latestFunctionContinuation = (items: Array<Record<string, unknown>>) => {
  let previousInteractionId = ''
  let lastInteractionCallIndex = -1
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (String(item.type || '') !== 'function_call') continue
    const interactionId = String(item._gemini_interaction_id || '')
    if (!interactionId) continue
    previousInteractionId = interactionId
    lastInteractionCallIndex = index
    break
  }
  if (!previousInteractionId || lastInteractionCallIndex < 0) return null

  const names = functionNamesByCallId(items)
  const results = items.slice(lastInteractionCallIndex + 1).flatMap(item => {
    if (String(item.type || '') !== 'function_call_output') return []
    const callId = String(item.call_id || '')
    const name = names.get(callId)
    if (!callId || !name) return []
    const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? null)
    return [{
      type: 'function_result',
      name,
      call_id: callId,
      result: [{ type: 'text', text: output.slice(0, 120_000) }],
    }]
  })

  return results.length ? { previousInteractionId, input: results } : null
}

export const latestGeminiProviderState = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (String(item.type || '') !== GEMINI_PROVIDER_STATE_TYPE) continue
    if (String(item.provider || '') !== 'gemini') continue
    if (String(item.version || '') !== GEMINI_PROVIDER_STATE_VERSION) continue
    const interactionId = String(item.interaction_id || '').trim()
    if (!interactionId) continue
    return { interactionId: interactionId.slice(0, 500), index }
  }
  return null
}

export const interactionInputFromJetWorkItems = (items: Array<Record<string, unknown>>) => {
  const names = functionNamesByCallId(items)
  const steps: Array<Record<string, unknown>> = []

  for (const item of items) {
    const type = String(item.type || '')
    const role = String(item.role || '')
    if (type === GEMINI_PROVIDER_STATE_TYPE) continue

    if (type === 'function_call') {
      const id = String(item.call_id || item.id || '')
      const name = String(item.name || '')
      if (!id || !name) continue
      steps.push({ type: 'function_call', id, name, arguments: parseArguments(item.arguments) })
      continue
    }

    if (type === 'function_call_output') {
      const callId = String(item.call_id || '')
      const name = names.get(callId)
      if (!callId || !name) continue
      const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? null)
      steps.push({
        type: 'function_result',
        name,
        call_id: callId,
        result: [{ type: 'text', text: output.slice(0, 120_000) }],
      })
      continue
    }

    const text = textFromContent(item.content)
    if (!text) continue
    if (role === 'user') {
      steps.push({ type: 'user_input', content: [{ type: 'text', text }] })
    } else if (role === 'assistant' || role === 'model' || type === 'message') {
      steps.push({ type: 'model_output', content: [{ type: 'text', text }] })
    }
  }

  return steps
}

const customToolsForInteractions = (tools: ReadonlyArray<Record<string, unknown>>) => tools.flatMap(raw => {
  if (String(raw.type || '') !== 'function') return []
  const name = String(raw.name || '').trim()
  if (!name) return []
  return [{
    type: 'function',
    name,
    ...(raw.description ? { description: String(raw.description) } : {}),
    ...(raw.parameters && typeof raw.parameters === 'object' ? { parameters: raw.parameters } : {}),
  }]
})

export const builtInToolsForInteractions = (input: { allowTools: boolean; allowProviderWeb?: boolean }) => {
  if (!input.allowTools) return []
  const builtIns: Array<Record<string, unknown>> = [
    { type: 'url_context' },
    { type: 'code_execution' },
  ]
  if (input.allowProviderWeb !== false) builtIns.unshift({ type: 'google_search', search_types: ['web_search'] })
  return builtIns
}

const thinkingLevel = (mode: GeminiInteractionWorkMode | undefined) => (
  mode === 'fast' ? 'low' : mode === 'deep' ? 'high' : 'medium'
)

export const buildGeminiInteractionsRequest = (input: GeminiInteractionsRequest) => {
  const functionContinuation = latestFunctionContinuation(input.items)
  const storedState = functionContinuation ? null : latestGeminiProviderState(input.items)
  const tools = input.allowTools
    ? [...builtInToolsForInteractions(input), ...customToolsForInteractions(input.tools)]
    : []

  let previousInteractionId = ''
  let interactionInput: Array<Record<string, unknown>> = []
  if (functionContinuation) {
    previousInteractionId = functionContinuation.previousInteractionId
    interactionInput = functionContinuation.input
  } else if (storedState) {
    previousInteractionId = storedState.interactionId
    interactionInput = interactionInputFromJetWorkItems(input.items.slice(storedState.index + 1))
  } else {
    interactionInput = interactionInputFromJetWorkItems(input.items)
  }

  return {
    model: GEMINI_INTERACTIONS_MODEL,
    ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
    input: interactionInput,
    system_instruction: cleanText(input.systemInstruction, 48_000),
    tools,
    generation_config: {
      max_output_tokens: Math.max(512, Math.min(Math.trunc(input.maxOutputTokens || 12_000), 65_536)),
      thinking_level: thinkingLevel(input.workMode),
      ...(tools.length ? { tool_choice: 'validated' } : {}),
    },
    stream: true,
    store: true,
    background: false,
  }
}

const stepsOf = (payload: Record<string, unknown>) => (
  Array.isArray(payload.steps) ? payload.steps as Array<Record<string, unknown>> : []
)

const safeUrl = (value: unknown) => {
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? url.slice(0, 2_000) : ''
}

const annotationsAndText = (step: Record<string, unknown>) => {
  if (!Array.isArray(step.content)) return { text: '', annotations: [] as Array<Record<string, unknown>> }
  let text = ''
  const annotations: Array<Record<string, unknown>> = []
  for (const raw of step.content as Array<unknown>) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') text += block.text
    if (Array.isArray(block.annotations)) {
      annotations.push(...block.annotations.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>)
    }
  }
  return { text, annotations }
}

const collectResultSources = (
  step: Record<string, unknown>,
  seenUrls: Set<string>,
  webSources: Array<{ title: string; url: string }>,
) => {
  const result = Array.isArray(step.result) ? step.result : []
  for (const raw of result) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const url = safeUrl(item.url)
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    const title = String(item.title || '').trim().slice(0, 500) || new URL(url).hostname.replace(/^www\./, '')
    webSources.push({ title, url })
  }
}

export const normalizeGeminiInteraction = (
  payload: Record<string, unknown>,
): GeminiInteractionsNormalizedResponse => {
  const interactionId = String(payload.id || '')
  const output: Array<Record<string, unknown>> = []
  const webSources: Array<{ title: string; url: string }> = []
  const webSearchQueries: string[] = []
  const seenUrls = new Set<string>()

  for (const step of stepsOf(payload)) {
    const type = String(step.type || '')

    if (type === 'function_call') {
      const name = String(step.name || '')
      const callId = String(step.id || '')
      if (!name || !callId) continue
      output.push({
        type: 'function_call',
        name,
        call_id: callId,
        arguments: JSON.stringify(step.arguments && typeof step.arguments === 'object' ? step.arguments : {}),
        _gemini_interaction_id: interactionId,
      })
      continue
    }

    if (type === 'google_search_call') {
      const args = step.arguments && typeof step.arguments === 'object' && !Array.isArray(step.arguments)
        ? step.arguments as Record<string, unknown>
        : {}
      const queries = Array.isArray(args.queries) ? args.queries : [args.query]
      for (const query of queries) {
        const normalized = String(query || '').trim()
        if (normalized) webSearchQueries.push(normalized)
      }
      continue
    }

    if (type === 'google_search_result' || type === 'url_context_result') {
      collectResultSources(step, seenUrls, webSources)
      continue
    }

    if (type !== 'model_output') continue
    const normalized = annotationsAndText(step)
    if (normalized.text.trim()) {
      output.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: normalized.text, annotations: normalized.annotations }],
        _gemini_interaction_id: interactionId,
      })
    }
    for (const annotation of normalized.annotations) {
      if (annotation.type !== 'url_citation') continue
      const url = safeUrl(annotation.url)
      if (!url || seenUrls.has(url)) continue
      seenUrls.add(url)
      const title = String(annotation.title || '').trim().slice(0, 500) || new URL(url).hostname.replace(/^www\./, '')
      webSources.push({ title, url })
    }
  }

  const rawUsage = payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
    ? payload.usage as Record<string, unknown>
    : {}
  const inputTokens = Math.max(0, Number(rawUsage.input_tokens ?? rawUsage.total_input_tokens ?? 0))
  const outputTokens = Math.max(0, Number(rawUsage.output_tokens ?? rawUsage.total_output_tokens ?? 0))
  const reasoningTokens = Math.max(0, Number(rawUsage.thoughts_tokens ?? rawUsage.total_thought_tokens ?? 0))
  const cachedTokens = Math.max(0, Number(rawUsage.cached_tokens ?? rawUsage.total_cached_tokens ?? 0))
  const totalTokens = Math.max(0, Number(rawUsage.total_tokens ?? (inputTokens + outputTokens + reasoningTokens)))

  return {
    id: interactionId || undefined,
    status: String(payload.status || 'completed'),
    model: String(payload.model || GEMINI_INTERACTIONS_MODEL),
    output,
    webSources,
    webSearchQueries: [...new Set(webSearchQueries)].slice(0, 20),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      cached_tokens: cachedTokens,
      total_tokens: totalTokens,
      gemini_interactions_api_calls: 1,
      gemini_interactions_steps: stepsOf(payload).length,
    },
  }
}
