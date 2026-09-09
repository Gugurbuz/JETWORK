import {
  providerForModel as baseProviderForModel,
  type NormalizedModelResponse,
} from './modelProvidersBase.ts'
import { AGENT_CONTROLLER_INSTRUCTION } from './agentControllerPolicy.ts'
import { extractGeminiRuntimeObservationInstruction } from './agent/controllerRuntimeObservation.ts'
import {
  buildPublicWorkProtocolInstruction,
  gateGeminiAgentToolsForPublicWork,
  hasCompletedPublicWorkStart,
} from './agent/publicWorkProtocol.ts'
import {
  createGeminiProviderStateItem,
  type GeminiInteractionPublicStepEvent,
  type GeminiInteractionsRequest,
} from './geminiInteractionsRuntimeV3.ts'
import { requestGeminiInteractionsResponseGA } from './geminiInteractionsTransportGA.ts'
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
  extractGeminiRuntimeObservationInstruction,
}
export type { GeminiInteractionPublicStepEvent }

export type AssistantProvider = 'openai' | 'gemini' | 'ollama'

export const PUBLIC_GEMINI_MODEL = 'gemini-3.8-flash'
export const DEFAULT_GEMINI_MODEL = PUBLIC_GEMINI_MODEL
const TERMINAL_SYNTHESIS_MARKER = 'Mekanik runtime tur sınırına ulaşıldı.'
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

const mergeUsage = (
  current: Record<string, number> | undefined,
  extra: Record<string, number>,
): Record<string, number> => ({ ...(current || {}), ...extra })

/**
 * Controller V4 provider boundary.
 *
 * Gemini 3.8 Flash is invoked through the GA Interactions API transport. JetWork
 * does not run a second semantic planner or choose a domain/tool sequence before
 * the active model. It enforces one mechanical lifecycle rule: if the model decides
 * to do substantive tool-backed work, the first tool round can only publish the
 * model's own public resolved-goal/work-plan snapshot. After that start observation
 * returns, the complete semantic capability surface is restored.
 *
 * The versioned product prompt remains part of the same Controller's stable system
 * contract. The lifecycle gate augments that contract; it never replaces or drops
 * the caller-selected stable product instruction.
 */
export async function requestGeminiResponse(input: GeminiRequestInput): Promise<NormalizedModelResponse> {
  const runtimeObservation = extractGeminiRuntimeObservationInstruction(input.instructions)
  const terminalSynthesis = input.instructions.includes(TERMINAL_SYNTHESIS_MARKER)
  const stableProductInstruction = String(input.stableInstructions || '').trim()
  const providerWebRequested = input.allowProviderWeb ?? input.allowTools
  const publicWorkGate = gateGeminiAgentToolsForPublicWork(input.items, input.tools, providerWebRequested)
  const publicWorkInstruction = buildPublicWorkProtocolInstruction(
    input.items,
    publicWorkGate.reportProgressAvailable,
  )
  const effectiveAllowTools = input.allowTools && (
    publicWorkGate.tools.length > 0 || publicWorkGate.providerWebEnabled
  )
  const interactionInput: GeminiInteractionsRequest = {
    apiKey: input.apiKey,
    model: PUBLIC_GEMINI_MODEL,
    systemInstruction: [
      stableProductInstruction,
      AGENT_CONTROLLER_INSTRUCTION,
      runtimeObservation,
      publicWorkInstruction,
    ].filter(Boolean).join('\n\n'),
    items: input.items,
    tools: effectiveAllowTools ? publicWorkGate.tools : [],
    allowTools: effectiveAllowTools,
    terminalSynthesis,
    allowProviderWeb: publicWorkGate.providerWebEnabled,
    workMode: input.workMode,
    maxOutputTokens: input.maxOutputTokens,
    onText: input.onText,
    onStepEvent: input.onStepEvent,
    signal: input.signal,
  }

  const response = await requestGeminiInteractionsResponseGA(interactionInput) as NormalizedModelResponse
  return {
    ...response,
    usage: mergeUsage(response.usage, {
      public_work_protocol_enabled: publicWorkGate.reportProgressAvailable ? 1 : 0,
      public_work_started: hasCompletedPublicWorkStart(input.items) ? 1 : 0,
      public_work_gate_pending: publicWorkGate.reportProgressAvailable && !publicWorkGate.started ? 1 : 0,
      public_work_visible_tools: publicWorkGate.tools.length,
      public_work_provider_web_enabled: publicWorkGate.providerWebEnabled ? 1 : 0,
    }),
  }
}