// Versioned Reasoning Engine v2 core implementation.
// Install provider guards before loading the implementation so provider
// requests share warm-isolate health state and bounded synthesis policy.
import { installGeminiFinalSynthesisThinkingGuard } from '../_shared/geminiThinkingGuard.ts'
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
// they can affect OpenAI provider health state.
installOpenAiCircuitBreaker()
installOllamaResponsesBridge()
installGeminiFinalSynthesisThinkingGuard()

// P1 rollout bridge: implementation.ts still reads the pre-V2 flag name while
// its semantic branches are being removed. The canonical AGENT_CONTROLLER_V2
// flag is the only rollout authority; mirror its resolved value into the legacy
// key before implementation.ts evaluates module-level constants. Missing or
// invalid canonical configuration therefore forces the durable core to legacy
// mode even if an old environment still has ASSISTANT_AGENTIC_CONTROLLER=true.
Deno.env.set('ASSISTANT_AGENTIC_CONTROLLER', isAgentControllerV2Enabled() ? 'true' : 'false')

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

// The durable core owns its lifecycle with RUN_TIMEOUT_MS and no longer binds
// reasoning execution to the incoming HTTP request abort signal.
await import('./implementation.ts')
