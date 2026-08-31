import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const LEGACY_ASSISTANT_PATH = '/functions/v1/openai-assistant'
const OLLAMA_CORE_PATH = '/functions/v1/openai-assistant-core-v2'
const OLLAMA_MODEL_PREFIX = 'ollama:'

const clean = (value: unknown) => String(value ?? '').trim()

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const requestMethod = (input: RequestInfo | URL, init?: RequestInit) => (
  clean(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() || 'GET'
)

const requestBodyText = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === 'string') return init.body
  if (input instanceof Request) {
    try { return await input.clone().text() } catch { return '' }
  }
  return ''
}

const installExplicitOllamaPrimaryRoute = () => {
  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL
    try {
      url = new URL(requestUrl(input))
    } catch {
      return originalFetch(input, init)
    }

    if (requestMethod(input, init) !== 'POST' || url.pathname !== LEGACY_ASSISTANT_PATH) {
      return originalFetch(input, init)
    }

    const bodyText = await requestBodyText(input, init)
    let model = ''
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>
      model = clean(parsed?.model)
    } catch {
      return originalFetch(input, init)
    }

    if (!model.startsWith(OLLAMA_MODEL_PREFIX)) return originalFetch(input, init)

    const routedUrl = new URL(url.href)
    routedUrl.pathname = OLLAMA_CORE_PATH
    console.info('PRIMARY_BRIDGE_OLLAMA_ROUTE', JSON.stringify({ model, target: OLLAMA_CORE_PATH }))
    return originalFetch(routedUrl.href, init)
  }
}

installExplicitOllamaPrimaryRoute()

// Preserve the current production primary bridge unchanged. The fetch shim above
// only diverts explicit ollama:* requests to the Ollama-aware v2 core.
await import('../openai-assistant-v2-primary-bridge-evidence/index.ts')
