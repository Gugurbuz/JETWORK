const GEMINI_HOST = 'generativelanguage.googleapis.com'
const GEMINI_FLASH_MODEL_PATHS = [
  '/models/gemini-3.5-flash:generateContent',
  '/models/gemini-3.5-flash:streamGenerateContent',
] as const
const COST_GUARD_MARKER = '[JETWORK_COST_GUARD]'

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const asObject = (value: unknown) => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)

export function applyGeminiThinkingGuardBody(url: string, body: Record<string, unknown>) {
  try {
    const parsed = new URL(url)
    if (
      parsed.hostname !== GEMINI_HOST
      || !GEMINI_FLASH_MODEL_PATHS.some(path => parsed.pathname.endsWith(path))
      || !JSON.stringify(body.systemInstruction ?? '').includes(COST_GUARD_MARKER)
      || (Array.isArray(body.tools) && body.tools.length > 0)
    ) return body

    const generationConfig = asObject(body.generationConfig) || {}
    if (asObject(generationConfig.thinkingConfig)) return body
    return {
      ...body,
      generationConfig: {
        ...generationConfig,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    }
  } catch {
    return body
  }
}

export function installGeminiFinalSynthesisThinkingGuard() {
  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== 'string') return originalFetch(input, init)
    let body: Record<string, unknown>
    try { body = JSON.parse(init.body) as Record<string, unknown> } catch { return originalFetch(input, init) }
    const guarded = applyGeminiThinkingGuardBody(requestUrl(input), body)
    return guarded === body
      ? originalFetch(input, init)
      : originalFetch(input, { ...init, body: JSON.stringify(guarded) })
  }) as typeof fetch
}
