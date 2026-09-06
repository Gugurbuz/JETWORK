import {
  providerForModel as baseProviderForModel,
  type NormalizedModelResponse,
} from './modelProvidersBase.ts'
import { AGENT_CONTROLLER_INSTRUCTION } from './agentControllerPolicy.ts'
import {
  requestGeminiInteractionsResponse,
  type GeminiInteractionsRequest,
} from './geminiInteractionsAgent.ts'
import {
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_MODELS,
  isOllamaModel,
  ollamaExecutionModel,
  requestOllamaResponse,
} from './ollamaProvider.ts'

export * from './modelProvidersBase.ts'
export {
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_MODELS,
  isOllamaModel,
  ollamaExecutionModel,
  requestOllamaResponse,
}

export type AssistantProvider = 'openai' | 'gemini' | 'ollama'

export const PUBLIC_GEMINI_MODEL = 'gemini-3.8-flash'
export const DEFAULT_GEMINI_MODEL = PUBLIC_GEMINI_MODEL
const LEGACY_GEMINI_MODEL_ALIASES = [
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
] as const
export const GEMINI_MODELS = new Set([PUBLIC_GEMINI_MODEL, ...LEGACY_GEMINI_MODEL_ALIASES])

export const providerForModel = (model: string): AssistantProvider => (
  isOllamaModel(model)
    ? 'ollama'
    : GEMINI_MODELS.has(model)
      ? 'gemini'
      : baseProviderForModel(model)
)

type GeminiRequestInput = {
  apiKey: string
  model: string
  instructions: string
  stableInstructions?: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  allowProviderWeb?: boolean
  workMode?: 'fast' | 'balanced' | 'deep'
  maxOutputTokens: number
  onText: (text: string) => void
  signal?: AbortSignal
}

/**
 * Controller V3 provider boundary.
 *
 * Gemini 3.8 Flash is invoked through the Interactions API. JetWork no longer
 * runs a provider-side semantic plan, knowledge/web route, mandatory retrieval
 * sequence or deterministic finalizer before the model gets to decide.
 *
 * The active model receives the minimal controller constitution plus the complete
 * tool surface supplied by the caller. The Interactions API owns native model
 * thought/tool lifecycle. JetWork remains the execution/security bridge for
 * custom functions and keeps its downstream mechanical grounding boundary.
 */
export async function requestGeminiResponse(input: GeminiRequestInput): Promise<NormalizedModelResponse> {
  const interactionInput: GeminiInteractionsRequest = {
    apiKey: input.apiKey,
    model: PUBLIC_GEMINI_MODEL,
    systemInstruction: AGENT_CONTROLLER_INSTRUCTION,
    items: input.items,
    tools: input.tools,
    allowTools: input.allowTools,
    allowProviderWeb: input.allowProviderWeb,
    workMode: input.workMode,
    maxOutputTokens: input.maxOutputTokens,
    onText: input.onText,
    signal: input.signal,
  }

  return await requestGeminiInteractionsResponse(interactionInput) as NormalizedModelResponse
}
