import {
  providerForModel as baseProviderForModel,
  type NormalizedModelResponse,
} from './modelProvidersBase.ts'
import { AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION } from './agentControllerPolicy.ts'
import { buildProviderProductCore } from './agent/providerProductCore.ts'
import { extractGeminiRuntimeObservationInstruction } from './agent/controllerRuntimeObservation.ts'
import {
  buildPublicWorkProtocolInstruction,
  gateGeminiAgentToolsForPublicWork,
  hasCompletedPublicWorkStart,
  PUBLIC_WORK_DIRECT_ANSWER_TOOL,
  PUBLIC_WORK_DIRECT_ANSWER_TOOL_NAME,
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

const PUBLIC_WORK_PROGRESS_UPDATE_TOOL = {
  type: 'function',
  name: 'report_progress',
  description: 'Optional user-visible update after work start. Use only for a material verified finding, a genuine plan change, or a real blocker; never for every tool round.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['finding', 'plan_change', 'blocked'] },
      message: { type: 'string', minLength: 2, maxLength: 500 },
      sourceRefs: { type: ['array', 'null'], items: { type: 'string', maxLength: 500 } },
    },
    required: ['kind', 'message', 'sourceRefs'],
    additionalProperties: false,
  },
} as const

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
 * does not run a second planner or choose a domain/tool sequence before
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
  const rawStableProductInstruction = String(input.stableInstructions || '').trim()
  const stableProductInstruction = buildProviderProductCore(rawStableProductInstruction)
  const providerWebRequested = input.allowProviderWeb ?? input.allowTools
  const publicWorkGate = gateGeminiAgentToolsForPublicWork(input.items, input.tools, providerWebRequested)
  const explicitFirstTurnDecision = Boolean(
    input.allowTools
      && publicWorkGate.reportProgressAvailable
      && !publicWorkGate.started
      && !terminalSynthesis
  )
  const continuationTools = publicWorkGate.started
    ? publicWorkGate.tools.map(tool => (
        String(tool.name || '') === 'report_progress'
          ? PUBLIC_WORK_PROGRESS_UPDATE_TOOL as unknown as typeof tool
          : tool
      ))
    : publicWorkGate.tools
  const visibleTools = explicitFirstTurnDecision
    ? [
        ...continuationTools,
        PUBLIC_WORK_DIRECT_ANSWER_TOOL as unknown as Record<string, unknown>,
      ]
    : continuationTools
  const publicWorkInstruction = buildPublicWorkProtocolInstruction(
    input.items,
    publicWorkGate.reportProgressAvailable,
  )
  const effectiveAllowTools = input.allowTools && (
    visibleTools.length > 0 || publicWorkGate.providerWebEnabled
  )
  const systemInstruction = [
    stableProductInstruction,
    AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION,
    runtimeObservation,
    publicWorkInstruction,
  ].filter(Boolean).join('\n\n')
  const toolSchemaCharacters = effectiveAllowTools ? JSON.stringify(visibleTools).length : 0
  const itemCharacters = JSON.stringify(input.items || []).length
  console.info('GEMINI_PROVIDER_PAYLOAD_BUDGET', JSON.stringify({
    product_core_chars: stableProductInstruction.length,
    controller_core_chars: AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION.length,
    runtime_observation_chars: runtimeObservation.length,
    public_work_chars: publicWorkInstruction.length,
    system_instruction_chars: systemInstruction.length,
    tool_schema_chars: toolSchemaCharacters,
    item_chars: itemCharacters,
  }))

  const interactionInput: GeminiInteractionsRequest = {
    apiKey: input.apiKey,
    model: PUBLIC_GEMINI_MODEL,
    systemInstruction,
    items: input.items,
    tools: effectiveAllowTools ? visibleTools : [],
    allowTools: effectiveAllowTools,
    terminalSynthesis,
    allowProviderWeb: publicWorkGate.providerWebEnabled,
    requiredFunctionNames: explicitFirstTurnDecision
      ? visibleTools.map(tool => String(tool.name || '')).filter(Boolean)
      : undefined,
    workMode: input.workMode,
    maxOutputTokens: input.maxOutputTokens,
    onText: input.onText,
    onStepEvent: input.onStepEvent,
    signal: input.signal,
  }

  const response = await requestGeminiInteractionsResponseGA(interactionInput) as NormalizedModelResponse
  let normalizedResponse = response

  if (explicitFirstTurnDecision) {
    const output = response.output || []
    const directCalls = output.filter(item => (
      String(item.type || '') === 'function_call'
      && String(item.name || '') === PUBLIC_WORK_DIRECT_ANSWER_TOOL_NAME
    ))
    const otherFunctionCalls = output.filter(item => (
      String(item.type || '') === 'function_call'
      && String(item.name || '') !== PUBLIC_WORK_DIRECT_ANSWER_TOOL_NAME
    ))

    if (directCalls.length > 0 && otherFunctionCalls.length === 0) {
      const directCall = directCalls[0] as Record<string, unknown>
      let args: Record<string, unknown> = {}
      try {
        args = typeof directCall.arguments === 'string'
          ? JSON.parse(directCall.arguments)
          : (directCall.arguments && typeof directCall.arguments === 'object'
              ? directCall.arguments as Record<string, unknown>
              : {})
      } catch {
        args = {}
      }
      const answer = String(args.answer || '').trim()
      if (!answer) throw new Error('Gemini explicit direct-answer decision returned an empty answer.')
      const interactionId = String(directCall._gemini_interaction_id || response.id || '').trim()
      input.onText(answer)
      normalizedResponse = {
        ...response,
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: answer, annotations: [] }],
          ...(interactionId ? { _gemini_interaction_id: interactionId } : {}),
        }],
        usage: mergeUsage(response.usage, { controller_direct_answer_decision: 1 }),
      }
    } else if (directCalls.length > 0 && otherFunctionCalls.length > 0) {
      normalizedResponse = {
        ...response,
        output: output.filter(item => !(
          String(item.type || '') === 'function_call'
          && String(item.name || '') === PUBLIC_WORK_DIRECT_ANSWER_TOOL_NAME
        )),
        usage: mergeUsage(response.usage, { controller_direct_answer_conflict_dropped: directCalls.length }),
      }
    } else if (otherFunctionCalls.length === 0) {
      throw new Error('Gemini explicit first-turn decision gate returned no function decision.')
    }
  }

  return {
    ...normalizedResponse,
    usage: mergeUsage(normalizedResponse.usage, {
      public_work_protocol_enabled: publicWorkGate.reportProgressAvailable ? 1 : 0,
      public_work_started: hasCompletedPublicWorkStart(input.items) ? 1 : 0,
      public_work_gate_pending: publicWorkGate.reportProgressAvailable && !publicWorkGate.started ? 1 : 0,
      public_work_visible_tools: visibleTools.length,
      public_work_provider_web_enabled: publicWorkGate.providerWebEnabled ? 1 : 0,
      controller_first_turn_decision_required: explicitFirstTurnDecision ? 1 : 0,
      provider_product_core_chars: stableProductInstruction.length,
      provider_controller_core_chars: AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION.length,
      provider_runtime_observation_chars: runtimeObservation.length,
      provider_public_work_chars: publicWorkInstruction.length,
      provider_system_instruction_chars: systemInstruction.length,
      provider_tool_schema_chars: toolSchemaCharacters,
      provider_item_chars: itemCharacters,
    }),
  }
}
