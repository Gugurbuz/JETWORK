// Versioned Reasoning Engine v2 core implementation.
// Install the provider guard before loading the implementation so every
// OpenAI request in planner, web research and synthesis shares the same
// warm-isolate circuit state.
import { installOpenAiCircuitBreaker } from '../_shared/providerCircuitBreaker.ts'

installOpenAiCircuitBreaker()

// The durable-core transport no longer binds the reasoning lifecycle to the
// incoming HTTP request signal. The legacy implementation finalizer still
// removes its former `abortRun` listener after the SSE controller closes.
// Keep that cleanup reference defined as a no-op until the implementation
// finalizer is inlined/removed; importantly, this does NOT attach a request
// abort listener or cancel the durable reasoning run.
;(globalThis as typeof globalThis & { abortRun?: () => void }).abortRun = () => {}

await import('./implementation.ts')
