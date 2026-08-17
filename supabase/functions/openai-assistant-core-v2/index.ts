// Versioned Reasoning Engine v2 core implementation.
// Install provider guards before loading the implementation so provider
// requests share warm-isolate health state and bounded synthesis policy.
import { installGeminiFinalSynthesisThinkingGuard } from '../_shared/geminiThinkingGuard.ts'
import { installOpenAiCircuitBreaker } from '../_shared/providerCircuitBreaker.ts'

installOpenAiCircuitBreaker()
installGeminiFinalSynthesisThinkingGuard()

// The durable core owns its lifecycle with RUN_TIMEOUT_MS and no longer binds
// reasoning execution to the incoming HTTP request abort signal.
await import('./implementation.ts')
