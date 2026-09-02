import { installGeminiFinalSynthesisThinkingGuard } from '../geminiThinkingGuard.ts'
import { OLLAMA_MODELS, OPENAI_MODELS } from '../modelProviders.ts'
import { installOllamaResponsesBridge } from '../ollamaResponsesBridge.ts'
import { installOpenAiCircuitBreaker } from '../providerCircuitBreaker.ts'
import { isAgentControllerV2Enabled } from './runtimeFlags.ts'

/**
 * Static-import bootstrap for the existing non-production Agentic core canary.
 * It must execute before implementation.ts evaluates its legacy compatibility
 * constant. Activation is accepted only when runtimeFlags identifies the current
 * Supabase deployment as an explicit code-owned canary deployment.
 */
if (!isAgentControllerV2Enabled()) {
  throw new Error('AGENTIC_CANARY_DEPLOYMENT_NOT_AUTHORIZED')
}

// Hosted Supabase Edge Runtime does not allow overwriting an existing project
// secret with Deno.env.set(). The durable implementation still reads the legacy
// flag at module evaluation time, so this canary isolate overlays only that read.
// No project secret is mutated and no request/header/body value can activate it.
const originalEnvGet = Deno.env.get.bind(Deno.env)
Deno.env.get = ((key: string) => (
  key === 'ASSISTANT_AGENTIC_CONTROLLER' ? 'true' : originalEnvGet(key)
)) as typeof Deno.env.get

for (const model of OLLAMA_MODELS) OPENAI_MODELS.add(model)
installOpenAiCircuitBreaker()
installOllamaResponsesBridge()
installGeminiFinalSynthesisThinkingGuard()
