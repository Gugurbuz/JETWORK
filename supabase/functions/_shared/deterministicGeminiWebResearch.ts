const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const DETERMINISTIC_GEMINI_WEB_MODEL = 'gemini-3.5-flash'

export interface DeterministicWebSource {
  title: string
  url: string
  snippet?: string
}

export interface DeterministicGeminiWebResult {
  text: string
  sources: DeterministicWebSource[]
  searchQueries: string[]
  searchCount: number
  usage?: Record<string, number>
}

const MODEL_PRICING = { input: 1.5, output: 9 } as const

export const buildDeterministicGeminiWebRequest = (input: {
  query: string
  complexity?: 'low' | 'medium' | 'high'
}) => ({
  model: DETERMINISTIC_GEMINI_WEB_MODEL,
  input: input.query.slice(0, 2_000),
  system_instruction: [
    'You are JetWork deterministic web evidence collector.',
    'You MUST execute Google Search before producing any output. Search only for evidence relevant to the supplied research target.',
    'Prefer primary, official and recent sources. Public web results are not proof of private enterprise behavior.',
    'Return concise grounded research notes. Do not provide the final JetWork answer.',
  ].join('\n'),
  tools: [{ type: 'google_search', search_types: ['web_search'] }],
  generation_config: {
    max_output_tokens: input.complexity === 'high' ? 1_800 : 1_200,
    thinking_level: input.complexity === 'high' ? 'low' : 'minimal',
    tool_choice: 'any',
  },
  stream: false,
  store: false,
  background: false,
})

const safeUrl = (value: unknown) => {
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? url.slice(0, 2_000) : ''
}

const stepsOf = (payload: Record<string, unknown>) => (
  Array.isArray(payload.steps) ? payload.steps as Array<Record<string, unknown>> : []
)

const groundingCount = (payload: Record<string, unknown>) => {
  const usage = payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
    ? payload.usage as Record<string, unknown>
    : {}
  const counts = Array.isArray(usage.grounding_tool_count) ? usage.grounding_tool_count : []
  return counts.reduce((total: number, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return total
    const item = raw as Record<string, unknown>
    return String(item.type || '') === 'google_search'
      ? total + Math.max(0, Number(item.count || 0))
      : total
  }, 0)
}

const searchQueries = (payload: Record<string, unknown>) => {
  const queries: string[] = []
  for (const step of stepsOf(payload)) {
    if (step.type !== 'google_search_call') continue
    const args = step.arguments && typeof step.arguments === 'object' && !Array.isArray(step.arguments)
      ? step.arguments as Record<string, unknown>
      : {}
    const query = String(args.query || '').trim()
    if (query) queries.push(query)
    if (Array.isArray(args.queries)) {
      queries.push(...args.queries.map(item => String(item || '').trim()).filter(Boolean))
    }
  }
  return [...new Set(queries)].slice(0, 12)
}

export const normalizeDeterministicGeminiWebResult = (
  payload: Record<string, unknown>,
): DeterministicGeminiWebResult => {
  const sources: DeterministicWebSource[] = []
  const notes: string[] = []
  const seen = new Set<string>()

  for (const step of stepsOf(payload)) {
    if (step.type === 'google_search_result' && Array.isArray(step.result)) {
      for (const raw of step.result as Array<unknown>) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Record<string, unknown>
        const url = safeUrl(item.url)
        if (!url || seen.has(url)) continue
        seen.add(url)
        const title = String(item.title || '').trim().slice(0, 500) || new URL(url).hostname.replace(/^www\./, '')
        const snippet = String(item.snippet || '').trim().slice(0, 2_000)
        sources.push({ title, url, ...(snippet ? { snippet } : {}) })
        notes.push(`[WEB_RESULT]\nTitle: ${title}\nURL: ${url}${snippet ? `\nSnippet: ${snippet}` : ''}`)
      }
    }

    if (step.type !== 'model_output' || !Array.isArray(step.content)) continue
    for (const rawBlock of step.content as Array<unknown>) {
      if (!rawBlock || typeof rawBlock !== 'object') continue
      const block = rawBlock as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        notes.push(`[GROUNDED_RESEARCH_NOTES]\n${block.text.trim().slice(0, 8_000)}`)
      }
      if (!Array.isArray(block.annotations)) continue
      for (const rawAnnotation of block.annotations as Array<unknown>) {
        if (!rawAnnotation || typeof rawAnnotation !== 'object') continue
        const annotation = rawAnnotation as Record<string, unknown>
        if (annotation.type !== 'url_citation') continue
        const url = safeUrl(annotation.url)
        if (!url || seen.has(url)) continue
        seen.add(url)
        const title = String(annotation.title || '').trim().slice(0, 500) || new URL(url).hostname.replace(/^www\./, '')
        sources.push({ title, url })
      }
    }
  }

  const rawUsage = payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
    ? payload.usage as Record<string, unknown>
    : {}
  const inputTokens = Math.max(0, Number(rawUsage.total_input_tokens || 0))
  const outputTokens = Math.max(0, Number(rawUsage.total_output_tokens || 0))
  const reasoningTokens = Math.max(0, Number(rawUsage.total_thought_tokens || 0))
  const totalTokens = Math.max(0, Number(rawUsage.total_tokens || (inputTokens + outputTokens + reasoningTokens)))
  const googleSearchCount = groundingCount(payload)
  const stepSearchCount = stepsOf(payload).filter(step => step.type === 'google_search_call').length
  const searchCount = Math.max(googleSearchCount, stepSearchCount)
  const estimatedCost = ((inputTokens * MODEL_PRICING.input + (outputTokens + reasoningTokens) * MODEL_PRICING.output) / 1_000_000)

  return {
    text: notes.join('\n\n').slice(0, 20_000),
    sources: sources.slice(0, 20),
    searchQueries: searchQueries(payload),
    searchCount,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: Number(estimatedCost.toFixed(6)),
      deterministic_web_executor_calls: 1,
      gemini_interactions_api_calls: 1,
      gemini_interactions_web_search_calls: searchCount,
      gemini_grounding_tool_calls: googleSearchCount,
    },
  }
}

export async function runDeterministicGeminiWebResearch(input: {
  apiKey: string
  query: string
  complexity?: 'low' | 'medium' | 'high'
  signal?: AbortSignal
}): Promise<DeterministicGeminiWebResult> {
  const response = await fetch(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'x-goog-api-key': input.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildDeterministicGeminiWebRequest({ query: input.query, complexity: input.complexity })),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? payload.error as Record<string, unknown>
      : {}
    throw new Error(String(error.message || `Gemini Interactions web research failed with ${response.status}.`))
  }
  return normalizeDeterministicGeminiWebResult(payload)
}
