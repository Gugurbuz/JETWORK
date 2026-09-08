// Versioned Reasoning Engine v2 core implementation.
// Install provider guards before loading the implementation so provider
// requests share warm-isolate health state and bounded synthesis policy.
import { installGeminiFinalSynthesisThinkingGuard } from '../_shared/geminiThinkingGuard.ts'
import { installGeminiProviderWebQuotaFallback } from '../_shared/geminiProviderWebQuotaFallback.ts'
import { OLLAMA_MODELS, OPENAI_MODELS } from '../_shared/modelProviders.ts'
import { installOllamaResponsesBridge } from '../_shared/ollamaResponsesBridge.ts'
import { installOpenAiCircuitBreaker } from '../_shared/providerCircuitBreaker.ts'
import { isAgentControllerV2Enabled } from '../_shared/runtime/runtimeFlags.ts'

// The durable core builds its allow-list from OPENAI_MODELS. Register the local
// model identifiers in that mutable set before implementation.ts evaluates its
// constants. providerForModel still reports these models as the distinct
// `ollama` provider, so telemetry and final events retain provider identity.
for (const model of OLLAMA_MODELS) OPENAI_MODELS.add(model)

// Keep the existing OpenAI circuit breaker around real OpenAI traffic. The
// Ollama bridge is installed afterwards so ollama:* requests are diverted before
// they can affect OpenAI provider health state. Gemini's provider-web guard is
// purely mechanical: it removes only the upstream google_search primitive after
// an actual quota failure and retries the same Gemini request with all remaining
// model-visible capabilities intact.
installOpenAiCircuitBreaker()
installOllamaResponsesBridge()
installGeminiFinalSynthesisThinkingGuard()
installGeminiProviderWebQuotaFallback()

// P1 rollout bridge: implementation.ts still reads the pre-V2 flag name while
// its semantic branches are being removed. Hosted Supabase Edge Runtime does not
// allow overwriting project-owned secrets with Deno.env.set(), so resolve the
// canonical flag once and overlay only reads needed by the active controller.
// No project secret is mutated, and request/header/body values cannot activate
// Controller V3 or alter its mechanical execution budget.
const agentControllerV2Enabled = isAgentControllerV2Enabled()
const originalEnvGet = Deno.env.get.bind(Deno.env)
Deno.env.get = ((key: string) => (
  key === 'ASSISTANT_AGENTIC_CONTROLLER'
    ? (agentControllerV2Enabled ? 'true' : 'false')
    : key === 'ASSISTANT_V2_MAX_TOOL_ROUNDS' && agentControllerV2Enabled
      ? '8'
      : originalEnvGet(key)
)) as typeof Deno.env.get

// A durable turn must not fail merely because the browser/test runner closes its
// response stream before the server-side controller has finished persistence.
// The implementation deliberately continues work after request aborts, so its
// direct controller.enqueue/close calls can legitimately race a downstream
// cancellation. Guard only the Web Streams "already closed" family of errors;
// every other exception is rethrown so real runtime failures stay observable.
const installDisconnectedStreamControllerGuard = () => {
  const Controller = (globalThis as Record<string, any>).ReadableStreamDefaultController
  const prototype = Controller?.prototype as Record<string, any> | undefined
  if (!prototype || prototype.__jetworkDisconnectGuardInstalled) return

  const isDisconnectedControllerError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '')
    return /cannot close or enqueue|controller is already closed|stream is closed|invalid state.*(?:closed|close|enqueue)/iu.test(message)
  }
  const guard = (methodName: 'enqueue' | 'close' | 'error') => {
    const original = prototype[methodName]
    if (typeof original !== 'function') return
    prototype[methodName] = function (...args: unknown[]) {
      try {
        return original.apply(this, args)
      } catch (error) {
        if (isDisconnectedControllerError(error)) return undefined
        throw error
      }
    }
  }

  guard('enqueue')
  guard('close')
  guard('error')
  Object.defineProperty(prototype, '__jetworkDisconnectGuardInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  })
}

installDisconnectedStreamControllerGuard()

// TTFT optimization: the core currently validates workspace access and only then
// loads the active assistant prompt. Those reads are independent. Prefetch the
// prompt as soon as the workspace lookup begins, then reuse the exact RPC response
// when the implementation asks for it. Authorization, prompt selection, routing,
// grounding and answer generation remain unchanged.
const installActivePromptPrefetch = () => {
  const originalFetch = globalThis.fetch.bind(globalThis)
  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/u, '')
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
  if (!supabaseUrl || !serviceRoleKey) return

  const pendingPrompts = new Map<string, Promise<Response>>()
  const workspaceIdFromUrl = (url: string) => {
    try {
      const parsed = new URL(url)
      if (!/\/rest\/v1\/workspaces$/u.test(parsed.pathname)) return ''
      const filter = parsed.searchParams.get('id') || ''
      return filter.startsWith('eq.') ? decodeURIComponent(filter.slice(3)) : ''
    } catch {
      return ''
    }
  }
  const workspaceIdFromPromptBody = (body: unknown) => {
    if (typeof body !== 'string') return ''
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      return String(parsed.p_workspace_id || '').trim()
    } catch {
      return ''
    }
  }
  const prefetchPrompt = (workspaceId: string) => {
    if (!workspaceId || pendingPrompts.has(workspaceId)) return
    const promise = originalFetch(`${supabaseUrl}/rest/v1/rpc/get_active_assistant_prompt`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_workspace_id: workspaceId }),
    })
    pendingPrompts.set(workspaceId, promise)
    void promise.catch(() => pendingPrompts.delete(workspaceId))
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const workspaceId = workspaceIdFromUrl(url)
    if (workspaceId && (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'GET') {
      prefetchPrompt(workspaceId)
      return originalFetch(input, init)
    }

    if (/\/rest\/v1\/rpc\/get_active_assistant_prompt(?:\?|$)/u.test(url)) {
      const promptWorkspaceId = workspaceIdFromPromptBody(init?.body)
      const prefetched = promptWorkspaceId ? pendingPrompts.get(promptWorkspaceId) : undefined
      if (prefetched) {
        pendingPrompts.delete(promptWorkspaceId)
        try {
          const response = await prefetched
          return response.clone()
        } catch {
          // Preserve existing behavior on prefetch failure by falling through to
          // the implementation's original RPC request.
        }
      }
    }

    return originalFetch(input, init)
  }
}

installActivePromptPrefetch()

// Interactions function continuation preserves server-side state through
// previous_interaction_id. On the mechanical terminal round the core deliberately
// sends an empty tool list; explicitly set tool_choice=none so a continuation can
// only synthesize text from already collected observations. This is not a semantic
// routing decision: Gemini chose every preceding tool, while the runtime merely
// enforces its already-declared terminal budget boundary.
const installGeminiTerminalSynthesisGuard = () => {
  const previousFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (
      /generativelanguage\.googleapis\.com\/v1(?:beta)?\/interactions(?:\?|$)/u.test(url)
      && typeof init?.body === 'string'
    ) {
      try {
        const payload = JSON.parse(init.body) as Record<string, any>
        const tools = Array.isArray(payload.tools) ? payload.tools : []
        if (tools.length === 0 && payload.previous_interaction_id) {
          payload.generation_config = {
            ...(payload.generation_config && typeof payload.generation_config === 'object' ? payload.generation_config : {}),
            tool_choice: 'none',
          }
          return previousFetch(input, { ...init, body: JSON.stringify(payload) })
        }
      } catch {
        // Preserve the provider request unchanged when the payload is not JSON.
      }
    }
    return previousFetch(input, init)
  }
}

installGeminiTerminalSynthesisGuard()

// The durable core owns its lifecycle with RUN_TIMEOUT_MS and no longer binds
// reasoning execution to the incoming HTTP request abort signal.
await import('./implementation.ts')
