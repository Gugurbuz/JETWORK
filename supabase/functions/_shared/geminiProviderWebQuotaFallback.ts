const GEMINI_INTERACTIONS_PATH = '/v1/interactions'
const PROVIDER_WEB_TYPE = 'google_search'
const QUOTA_MARKER = /quota_exceeded|exceeded your current quota|resource_exhausted/i
const CIRCUIT_MS = 60_000

let providerWebUnavailableUntil = 0
let installed = false

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const parseBody = (body: BodyInit | null | undefined): Record<string, unknown> | null => {
  if (typeof body !== 'string' || !body.trim()) return null
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const hasProviderWebTool = (body: Record<string, unknown>) => (
  Array.isArray(body.tools)
  && body.tools.some(raw => raw && typeof raw === 'object' && String((raw as Record<string, unknown>).type || '') === PROVIDER_WEB_TYPE)
)

const withoutProviderWebTool = (body: Record<string, unknown>) => {
  const tools = Array.isArray(body.tools)
    ? body.tools.filter(raw => !(raw && typeof raw === 'object' && String((raw as Record<string, unknown>).type || '') === PROVIDER_WEB_TYPE))
    : []
  const generationConfig = body.generation_config && typeof body.generation_config === 'object' && !Array.isArray(body.generation_config)
    ? { ...(body.generation_config as Record<string, unknown>) }
    : {}
  if (!tools.length && generationConfig.tool_choice === 'validated') generationConfig.tool_choice = 'none'
  const availabilityNote = [
    'RUNTIME_CAPABILITY_AVAILABILITY:',
    'Provider-native Google Search is temporarily unavailable because the upstream search quota is exhausted.',
    'Do not claim that live web search succeeded. Continue with the remaining visible JetWork capabilities and available evidence.',
    'If the user explicitly requires current web evidence and no equivalent evidence is available, state that limitation clearly.',
  ].join(' ')
  return {
    ...body,
    tools,
    generation_config: generationConfig,
    system_instruction: [String(body.system_instruction || '').trim(), availabilityNote].filter(Boolean).join('\n\n'),
  }
}

const quotaExceededInStreamPrefix = async (response: Response) => {
  if (!response.body) return false
  const reader = response.clone().body?.getReader()
  if (!reader) return false
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (buffer.length < 64_000) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) buffer += decoder.decode(value, { stream: true })
      if (QUOTA_MARKER.test(buffer)) return true
      if (/event:\s*step\.start|event:\s*interaction\.completed/i.test(buffer)) return false
    }
    buffer += decoder.decode()
    return QUOTA_MARKER.test(buffer)
  } finally {
    // A cloned Response body is a tee branch. Awaiting cancellation of one
    // branch before the original branch is cancelled can deadlock the retry.
    // Fire-and-forget here; the caller cancels the original branch immediately
    // after quota detection, which lets both tee branches settle.
    void reader.cancel().catch(() => undefined)
  }
}

const quotaExceededResponse = async (response: Response) => {
  if (response.status === 429) {
    const text = await response.clone().text().catch(() => '')
    return QUOTA_MARKER.test(text) || response.status === 429
  }
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('text/event-stream')) return false
  return quotaExceededInStreamPrefix(response)
}

/**
 * Mechanical provider-availability guard for Controller V3.
 *
 * Gemini remains the sole semantic authority. The original request always keeps
 * provider-native web visible. Only an upstream quota failure opens a short
 * availability circuit and retries the same model request without that one
 * unavailable provider primitive. No query, route, tool choice, evidence choice
 * or stop/final decision is made here.
 */
export const installGeminiProviderWebQuotaFallback = () => {
  if (installed) return
  installed = true
  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const body = parseBody(init?.body)
    if (!url.includes('generativelanguage.googleapis.com') || !url.includes(GEMINI_INTERACTIONS_PATH) || !body || !hasProviderWebTool(body)) {
      return originalFetch(input, init)
    }

    const retryWithoutProviderWeb = () => originalFetch(input, {
      ...init,
      body: JSON.stringify(withoutProviderWebTool(body)),
    })

    if (Date.now() < providerWebUnavailableUntil) return retryWithoutProviderWeb()

    const response = await originalFetch(input, init)
    if (!await quotaExceededResponse(response)) return response

    providerWebUnavailableUntil = Date.now() + CIRCUIT_MS
    try { await response.body?.cancel() } catch {}
    return retryWithoutProviderWeb()
  }) as typeof globalThis.fetch
}
