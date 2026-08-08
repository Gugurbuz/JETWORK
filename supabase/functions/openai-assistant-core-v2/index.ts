// Versioned Reasoning Engine v2 core implementation.
// Install the provider guard before loading the implementation so every
// OpenAI request in planner, web research and synthesis shares the same
// warm-isolate circuit state.
import { installOpenAiCircuitBreaker } from '../_shared/providerCircuitBreaker.ts'

installOpenAiCircuitBreaker()
await import('./implementation.ts')
