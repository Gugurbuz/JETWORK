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

// The durable-core transport no longer binds the reasoning lifecycle to the
// incoming HTTP request signal. The legacy implementation finalizer still
// removes its former `abortRun` listener after the SSE controller closes.
// Keep that cleanup reference defined as a no-op until the implementation
// finalizer is inlined/removed; importantly, this does NOT attach a request
// abort listener or cancel the durable reasoning run.
;(globalThis as typeof globalThis & { abortRun?: () => void }).abortRun = () => {}

await import('./implementation.ts')
