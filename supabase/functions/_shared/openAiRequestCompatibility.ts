const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

const requestUrl = (input: RequestInfo | URL) => (
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
)

export const sanitizeOpenAiFunctionSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeOpenAiFunctionSchema)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) {
    // The Responses API function-schema validator rejects JSON Schema's
    // uniqueItems keyword. Removing this annotation does not change runtime
    // tool authority or tool selection; argument validation still happens in
    // JetWork's tool execution boundary.
    if (key === 'uniqueItems') continue
    normalized[key] = sanitizeOpenAiFunctionSchema(child)
  }
  return normalized
}

export const normalizeOpenAiResponsesBody = (body: Record<string, unknown>): Record<string, unknown> => {
  const tools = Array.isArray(body.tools) ? body.tools : null
  if (!tools) return body
  let changed = false
  const normalizedTools = tools.map(tool => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return tool
    const candidate = tool as Record<string, unknown>
    if (candidate.type !== 'function' || !candidate.parameters || typeof candidate.parameters !== 'object') return tool
    changed = true
    return {
      ...candidate,
      parameters: sanitizeOpenAiFunctionSchema(candidate.parameters),
    }
  })
  return changed ? { ...body, tools: normalizedTools } : body
}

export const createOpenAiRequestCompatibilityFetch = (baseFetch: typeof fetch): typeof fetch => (
  async (input, init) => {
    const url = requestUrl(input)
    if (!url.startsWith(OPENAI_RESPONSES_URL) || typeof init?.body !== 'string') {
      return baseFetch(input, init)
    }
    try {
      const parsed = JSON.parse(init.body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return baseFetch(input, init)
      const normalized = normalizeOpenAiResponsesBody(parsed as Record<string, unknown>)
      return baseFetch(input, { ...init, body: JSON.stringify(normalized) })
    } catch {
      return baseFetch(input, init)
    }
  }
)

let installed = false

export const installOpenAiRequestCompatibility = () => {
  if (installed) return
  installed = true
  globalThis.fetch = createOpenAiRequestCompatibilityFetch(globalThis.fetch.bind(globalThis))
}
