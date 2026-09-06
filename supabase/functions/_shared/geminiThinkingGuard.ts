const GEMINI_HOST = 'generativelanguage.googleapis.com'
const COST_GUARD_MARKER = '[JETWORK_COST_GUARD]'

type BoundedFinalThinkingLevel = 'minimal' | 'low'

const GEMINI_FLASH_THINKING_POLICIES: ReadonlyArray<{
  path: string
  thinkingLevel: BoundedFinalThinkingLevel
}> = [
  {
    path: '/models/gemini-3.5-flash:generateContent',
    thinkingLevel: 'minimal',
  },
  {
    path: '/models/gemini-3.5-flash:streamGenerateContent',
    thinkingLevel: 'minimal',
  },
  {
    path: '/models/gemini-3.8-flash:generateContent',
    thinkingLevel: 'low',
  },
  {
    path: '/models/gemini-3.8-flash:streamGenerateContent',
    thinkingLevel: 'low',
  },
] as const

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

const boundedFinalThinkingLevelForUrl = (url: string): BoundedFinalThinkingLevel | null => {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== GEMINI_HOST) return null
    const policy = GEMINI_FLASH_THINKING_POLICIES.find(item => parsed.pathname.endsWith(item.path))
    return policy?.thinkingLevel ?? null
  } catch {
    return null
  }
}

export function applyGeminiThinkingGuardBody(
  url: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const thinkingLevel = boundedFinalThinkingLevelForUrl(url)
  if (!thinkingLevel) return body
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
      thinkingConfig: { thinkingLevel },
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

    console.info('[gemini-thinking-guard] bounded final synthesis thinking policy applied')
    return currentFetch(input, {
      ...init,
      body: JSON.stringify(guardedBody),
    })
  }) as typeof fetch
}
