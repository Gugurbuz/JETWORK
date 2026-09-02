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

Deno.env.set('ASSISTANT_AGENTIC_CONTROLLER', 'true')
for (const model of OLLAMA_MODELS) OPENAI_MODELS.add(model)
installOpenAiCircuitBreaker()
installOllamaResponsesBridge()
installGeminiFinalSynthesisThinkingGuard()
