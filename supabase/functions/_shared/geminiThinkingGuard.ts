const GEMINI_HOST = 'generativelanguage.googleapis.com'
const GEMINI_FLASH_MODEL_PATHS = [
  '/models/gemini-3.5-flash:generateContent',
  '/models/gemini-3.5-flash:streamGenerateContent',
] as const
const COST_GUARD_MARKER = '[JETWORK_COST_GUARD]'

const requestUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const asObject = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)

const systemInstructionText = (body: Record<string, unknown>) => {
  try {
    return JSON.stringify(body.systemInstruction ?? '')
  } catch {
    return ''
  }
}

const isGeminiFlashGenerateContent = (url: string) => {
  try {
    const parsed = new URL(url)
    return parsed.hostname === GEMINI_HOST
      && GEMINI_FLASH_MODEL_PATHS.some(path => parsed.pathname.endsWith(path))
  } catch {
    return false
  }
}

export function applyGeminiThinkingGuardBody(
  url: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!isGeminiFlashGenerateContent(url)) return body
  if (!systemInstructionText(body).includes(COST_GUARD_MARKER)) return body

  const tools = Array.isArray(body.tools) ? body.tools : []
  if (tools.length > 0) return body

  const generationConfig = asObject(body.generationConfig) || {}
  const thinkingConfig = asObject(generationConfig.thinkingConfig)
  if (thinkingConfig) return body

  return {
    ...body,
    generationConfig: {
      ...generationConfig,
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  }
}

export function installGeminiFinalSynthesisThinkingGuard(): void {
  const currentFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (input, init) => {
    if (typeof init?.body !== 'string') return currentFetch(input, init)

    const url = requestUrl(input)
    let parsedBody: Record<string, unknown>
    try {
      const parsed = JSON.parse(init.body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return currentFetch(input, init)
      parsedBody = parsed as Record<string, unknown>
    } catch {
      return currentFetch(input, init)
    }

    const guardedBody = applyGeminiThinkingGuardBody(url, parsedBody)
    if (guardedBody === parsedBody) return currentFetch(input, init)

    console.info('[gemini-thinking-guard] minimal thinking applied to bounded final synthesis')
    return currentFetch(input, {
      ...init,
      body: JSON.stringify(guardedBody),
    })
  }) as typeof fetch
}
