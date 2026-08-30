// Versioned Reasoning Engine v2 core implementation.
// Install provider and stream lifecycle guards before loading the implementation
// so warm isolates share bounded provider policy and durable transport safety.
import { installGeminiFinalSynthesisThinkingGuard } from '../_shared/geminiThinkingGuard.ts'
import { installOpenAiCircuitBreaker } from '../_shared/providerCircuitBreaker.ts'
import { installStreamControllerLifecycleGuard } from '../_shared/streamControllerGuard.ts'

// The reasoning core is durable: if the browser navigates away after the turn
// starts, late SSE writes must become no-ops while model/tool execution and DB
// completion continue. This guard only swallows native "controller closed"
// lifecycle errors; unrelated stream/runtime errors still propagate.
installStreamControllerLifecycleGuard()
installOpenAiCircuitBreaker()
installGeminiFinalSynthesisThinkingGuard()

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
