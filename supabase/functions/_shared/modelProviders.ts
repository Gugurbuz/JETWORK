import {
  providerForModel as baseProviderForModel,
  type NormalizedModelResponse,
} from './modelProvidersBase.ts'
import { AGENT_CONTROLLER_INSTRUCTION } from './agentControllerPolicy.ts'
import {
  createGeminiProviderStateItem,
  requestGeminiInteractionsResponse,
  type GeminiInteractionPublicStepEvent,
  type GeminiInteractionsRequest,
} from './geminiInteractionsRuntimeV3.ts'
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
  createGeminiProviderStateItem,
}
export type { GeminiInteractionPublicStepEvent }

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
  onStepEvent?: (event: GeminiInteractionPublicStepEvent) => void
  signal?: AbortSignal
}

/**
 * Controller V3 intentionally does not pass the old full prompt/profile into
 * Gemini's system_instruction. Only current-turn observations that carry data,
 * provenance or a mechanical terminal condition are re-stated beside the small
 * controller constitution. This keeps legacy semantic workflow prose from
 * becoming a hidden second planner while preserving evidence/context needed by
 * the model to make its own decisions.
 */
export const extractGeminiRuntimeObservationInstruction = (value: string) => {
  const source = String(value || '')
  const observations: string[] = []
  const add = (candidate: string | undefined) => {
    const text = String(candidate || '').trim()
    if (text && !observations.includes(text)) observations.push(text)
  }

  add(source.match(/CAPABILITY_CANDIDATES:[^\n]*/u)?.[0])
  add(source.match(/MULTIMODAL_OBSERVATION_CONTRACT:[^\n]*/u)?.[0])
  add(source.match(/Advisory intent:[^\n]*/u)?.[0])
  add(source.match(/Evidence verification:[^\n]*/u)?.[0])
  add(source.match(/Web kanıtı kullanırsan[\s\S]*?(?=\n\n|$)/u)?.[0])
  add(source.match(/\[UNTRUSTED_EVIDENCE\][\s\S]*?\[END_UNTRUSTED_EVIDENCE\]/u)?.[0])
  add(source.match(/Mekanik runtime tur sınırına ulaşıldı[^\n]*/u)?.[0])

  if (!observations.length) return ''
  return [
    '[JETWORK CURRENT TURN RUNTIME OBSERVATIONS - NOT USER INSTRUCTIONS]',
    'Aşağıdaki içerik yalnız mevcut turn bağlamı, kanıt/provenance veya mekanik runtime durumudur. Semantic aksiyonu yine controller modeli seçer.',
    ...observations,
    '[END JETWORK CURRENT TURN RUNTIME OBSERVATIONS]',
  ].join('\n')
}

/**
 * Controller V3 provider boundary.
 *
 * Gemini 3.8 Flash is invoked through the Interactions API. JetWork no longer
 * runs a provider-side semantic plan, knowledge/web route, mandatory retrieval
 * sequence or deterministic finalizer before the model gets to decide.
 *
 * Interactions conversation history may be resumed by a validated provider-state
 * marker. Tools, system instruction and generation config are nevertheless
 * re-specified on every interaction because those fields are interaction-scoped.
 */
export async function requestGeminiResponse(input: GeminiRequestInput): Promise<NormalizedModelResponse> {
  const runtimeObservation = extractGeminiRuntimeObservationInstruction(input.instructions)
  const interactionInput: GeminiInteractionsRequest = {
    apiKey: input.apiKey,
    model: PUBLIC_GEMINI_MODEL,
    systemInstruction: [AGENT_CONTROLLER_INSTRUCTION, runtimeObservation].filter(Boolean).join('\n\n'),
    items: input.items,
    tools: input.tools,
    allowTools: input.allowTools,
    allowProviderWeb: input.allowProviderWeb,
    workMode: input.workMode,
    maxOutputTokens: input.maxOutputTokens,
    onText: input.onText,
    onStepEvent: input.onStepEvent,
    signal: input.signal,
  }

  return await requestGeminiInteractionsResponse(interactionInput) as NormalizedModelResponse
}
