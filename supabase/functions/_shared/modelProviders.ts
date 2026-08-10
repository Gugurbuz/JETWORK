import {
  DEFAULT_GEMINI_MODEL as LEGACY_DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS as LEGACY_GEMINI_MODELS,
  GEMINI_SUBSTANTIVE_MODEL,
  OPENAI_MODELS,
  isTrivialConversationalTurn as legacyIsTrivialConversationalTurn,
  providerForModel as legacyProviderForModel,
  requestGeminiResponse as legacyRequestGeminiResponse,
  type AssistantProvider,
  type NormalizedModelResponse,
} from './modelProvidersLegacy.ts'
import {
  GEMINI_AGENT_MODEL,
  GEMINI_SEMANTIC_MODEL,
  buildGeminiFinalSynthesisItems,
  compactGeminiAgentItems,
  costGuardAgentInstruction,
  executedToolCallCount,
  extractSemanticPlanFromItems,
  isBoundedKnowledgePlan,
  mergeNumericUsage,
  normalizeGeminiRequestedModel,
  responseHasFunctionCall,
  responseVisibleText,
  toolBudgetForPlan,
  usageWithGeminiEstimatedCost,
} from './geminiCostGuard.ts'
import { compactAssistantConversationMemory } from './conversationMemory.ts'
import {
  buildEnumerationFastPathDispatch,
  buildOpenAiEnumerationFastPathMarkerItem,
  buildSyntheticEnumerationFunctionCall,
} from './enumerationFastPath.ts'
import type { ReasoningPlan } from './reasoningEngine.ts'

export const DEFAULT_GEMINI_MODEL = LEGACY_DEFAULT_GEMINI_MODEL
export const GEMINI_MODELS = new Set([
  ...LEGACY_GEMINI_MODELS,
  GEMINI_AGENT_MODEL,
  GEMINI_SEMANTIC_MODEL,
])
export { GEMINI_AGENT_MODEL, GEMINI_SEMANTIC_MODEL, GEMINI_SUBSTANTIVE_MODEL, OPENAI_MODELS }
export type { AssistantProvider, NormalizedModelResponse }

export const providerForModel = (model: string): AssistantProvider => {
  const normalized = normalizeGeminiRequestedModel(model)
  return GEMINI_MODELS.has(normalized) ? 'gemini' : legacyProviderForModel(normalized)
}

const INTERNAL_SEMANTIC_PLAN_PATTERN = /\n?\[JETWORK_SEMANTIC_PLAN\][\s\S]*?\[END_JETWORK_SEMANTIC_PLAN\]\s*/gi

export const stripInternalSemanticPlan = (value: string) => value
  .replace(INTERNAL_SEMANTIC_PLAN_PATTERN, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    return typeof (part as Record<string, unknown>).text === 'string'
      ? String((part as Record<string, unknown>).text)
      : ''
  }).filter(Boolean).join('\n')
}

const sanitizeContent = (content: unknown): unknown => {
  if (typeof content === 'string') return stripInternalSemanticPlan(content)
  if (!Array.isArray(content)) return content
  return content.map(part => {
    if (typeof part === 'string') return stripInternalSemanticPlan(part)
    if (!part || typeof part !== 'object') return part
    const clean = { ...(part as Record<string, unknown>) }
    if (typeof clean.text === 'string') clean.text = stripInternalSemanticPlan(clean.text)
    return clean
  })
}

const compactAssistantContent = (content: unknown): unknown => {
  if (typeof content === 'string') return compactAssistantConversationMemory(content, 1_200)
  if (!Array.isArray(content)) return content
  const text = content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    return typeof (part as Record<string, unknown>).text === 'string'
      ? String((part as Record<string, unknown>).text)
      : ''
  }).filter(Boolean).join('\n')
  if (!text) return content
  return compactAssistantConversationMemory(text, 1_200)
}

const sanitizeItems = (items: Array<Record<string, unknown>>) => items.map(item => {
  const clean = { ...item }
  if ('content' in clean) clean.content = sanitizeContent(clean.content)
  const role = String(clean.role || '')
  if (role === 'assistant' && 'content' in clean) clean.content = compactAssistantContent(clean.content)
  return clean
})

export const isTrivialConversationalTurn = (items: Array<Record<string, unknown>>) => (
  legacyIsTrivialConversationalTurn(sanitizeItems(items))
)

const withEstimatedCost = (
  response: NormalizedModelResponse,
  markers: Record<string, number> = {},
): NormalizedModelResponse => ({
  ...response,
  usage: usageWithGeminiEstimatedCost(String(response.model || ''), response.usage, markers),
})

const withStageUsage = (
  response: NormalizedModelResponse,
  stage: 'agent' | 'final',
  markers: Record<string, number> = {},
): NormalizedModelResponse => {
  const enriched = withEstimatedCost(response, markers)
  const usage = enriched.usage || {}
  const stageUsage: Record<string, number> = {}
  const inputTokens = Number(usage.input_tokens || 0)
  const outputTokens = Number(usage.output_tokens || 0)
  const reasoningTokens = Number(usage.reasoning_tokens || 0)
  const estimatedCost = Number(usage.estimated_cost_usd || 0)
  if (inputTokens) stageUsage[`cost_guard_${stage}_input_tokens`] = inputTokens
  if (outputTokens) stageUsage[`cost_guard_${stage}_output_tokens`] = outputTokens
  if (reasoningTokens) stageUsage[`cost_guard_${stage}_reasoning_tokens`] = reasoningTokens
  if (estimatedCost) stageUsage[`cost_guard_${stage}_estimated_cost_usd`] = estimatedCost
  return { ...enriched, usage: mergeNumericUsage(enriched.usage, stageUsage) }
}

const withRequestedModelObservability = (
  response: NormalizedModelResponse,
  requestedModel: string,
): NormalizedModelResponse => {
  const actualModel = String(response.model || '')
  if (!actualModel || actualModel === requestedModel) return response
  return {
    ...response,
    usage: mergeNumericUsage(response.usage, {
      cost_guard_model_switch: 1,
      cost_guard_provider_model_fallback: 1,
    }),
  }
}

type BoundedKnowledgeDispatch = {
  toolName: string
  args: Record<string, unknown>
  stage: 'search' | 'detail'
}

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

const latestUserText = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (String(items[index].role || '') !== 'user') continue
    return stripInternalSemanticPlan(textFromContent(items[index].content)).trim()
  }
  return ''
}

const toolNamesByCallId = (items: Array<Record<string, unknown>>) => {
  const names = new Map<string, string>()
  for (const item of items) {
    if (String(item.type || '') !== 'function_call') continue
    names.set(String(item.call_id || ''), String(item.name || ''))
  }
  return names
}

const detailDispatchForRecord = (record: Record<string, unknown>): BoundedKnowledgeDispatch | null => {
  const objectType = String(record.objectType || '').toLocaleLowerCase('en-US')
  const canonicalKey = String(record.canonicalKey || '').trim()
  if (!canonicalKey) return null
  if (objectType === 'message') return { toolName: 'get_message_detail', args: { messageCode: canonicalKey }, stage: 'detail' }
  if (['class', 'method', 'function'].includes(objectType)) return { toolName: 'get_abap_source', args: { canonicalKey }, stage: 'detail' }
  if (['document', 'business_rule'].includes(objectType)) return { toolName: 'get_document_content', args: { canonicalKey }, stage: 'detail' }
  return { toolName: 'get_knowledge_object', args: { canonicalKey }, stage: 'detail' }
}

const buildBoundedKnowledgeDispatch = (
  items: Array<Record<string, unknown>>,
  plan: ReasoningPlan | null,
): BoundedKnowledgeDispatch | null => {
  if (!isBoundedKnowledgePlan(plan)) return null
  const userText = latestUserText(items)
  if (!userText || userText.length > 320 || /\[UNTRUSTED_CHAT_ATTACHMENT_/i.test(userText)) return null

  const outputs = items.filter(item => String(item.type || '') === 'function_call_output')
  if (outputs.length === 0) {
    return {
      toolName: 'search_knowledge_catalog',
      args: { query: userText, objectTypes: null, limit: 6 },
      stage: 'search',
    }
  }

  if (outputs.length !== 1) return null
  const names = toolNamesByCallId(items)
  const output = outputs[0]
  const callName = names.get(String(output.call_id || '')) || ''
  if (callName !== 'search_knowledge_catalog') return null
  const parsed = parseJsonObject(output.output)
  const records = Array.isArray(parsed?.records)
    ? parsed.records.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>
    : []
  if (!records.length) return null
  return detailDispatchForRecord(records[0])
}

const buildSyntheticKnowledgeFunctionCall = (dispatch: BoundedKnowledgeDispatch) => ({
  type: 'function_call',
  call_id: `jetwork-knowledge-fast:${crypto.randomUUID()}`,
  name: dispatch.toolName,
  arguments: JSON.stringify(dispatch.args),
})

const finalizeWithRequestedModel = async (input: {
  apiKey: string
  requestedModel: string
  instructions: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  maxOutputTokens: number
  onText: (text: string) => void
  signal?: AbortSignal
  agentDraft?: string
  priorUsage?: Record<string, number>
  forced?: boolean
}): Promise<NormalizedModelResponse> => {
  const finalResponse = withRequestedModelObservability(withStageUsage(await legacyRequestGeminiResponse({
    apiKey: input.apiKey,
    model: input.requestedModel,
    instructions: `${input.instructions}\n\n[JETWORK_COST_GUARD] Araştırma tamamlandı. Yeni araç çağrısı yapmadan kanıta dayalı nihai kullanıcı yanıtını üret.`,
    items: buildGeminiFinalSynthesisItems(input.items, input.agentDraft || ''),
    tools: input.tools,
    allowTools: false,
    maxOutputTokens: input.maxOutputTokens,
    onText: input.onText,
    signal: input.signal,
  }), 'final', {
    cost_guard_final_calls: 1,
    ...(input.forced ? { cost_guard_forced_synthesis: 1 } : {}),
  }), input.requestedModel)

  return {
    ...finalResponse,
    usage: mergeNumericUsage(input.priorUsage, finalResponse.usage),
  }
}

export async function requestGeminiResponse(input: {
  apiKey: string
  model: string
  instructions: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  maxOutputTokens: number
  onText: (text: string) => void
  signal?: AbortSignal
}): Promise<NormalizedModelResponse> {
  const requestedModel = normalizeGeminiRequestedModel(input.model)
  const plan = extractSemanticPlanFromItems(input.items)
  const enumerationDispatch = input.allowTools ? buildEnumerationFastPathDispatch(input.items) : null
  if (enumerationDispatch) {
    return {
      id: `jetwork-enum-fast:${crypto.randomUUID()}`,
      status: 'completed',
      model: GEMINI_AGENT_MODEL,
      output: [buildSyntheticEnumerationFunctionCall(enumerationDispatch)],
      usage: {
        deterministic_enumeration_dispatch: 1,
        deterministic_provider_calls_avoided: 1,
        cost_guard_agent_calls_avoided: 1,
      },
    }
  }

  const boundedKnowledgeDispatch = input.allowTools ? buildBoundedKnowledgeDispatch(input.items, plan) : null
  if (boundedKnowledgeDispatch) {
    return {
      id: `jetwork-knowledge-fast:${crypto.randomUUID()}`,
      status: 'completed',
      model: GEMINI_AGENT_MODEL,
      output: [buildSyntheticKnowledgeFunctionCall(boundedKnowledgeDispatch)],
      usage: {
        deterministic_knowledge_dispatch: 1,
        deterministic_provider_calls_avoided: 1,
        cost_guard_agent_calls_avoided: 1,
        [`deterministic_knowledge_${boundedKnowledgeDispatch.stage}_dispatch`]: 1,
      },
    }
  }

  const sanitizedItems = sanitizeItems(input.items)

  if (!input.allowTools) {
    return withRequestedModelObservability(withStageUsage(await legacyRequestGeminiResponse({
      ...input,
      model: requestedModel,
      items: sanitizedItems,
    }), 'final', { cost_guard_final_calls: 1 }), requestedModel)
  }

  const executedTools = executedToolCallCount(sanitizedItems)
  const toolBudget = toolBudgetForPlan(plan)
  if (executedTools >= toolBudget) {
    return finalizeWithRequestedModel({
      apiKey: input.apiKey,
      requestedModel,
      instructions: input.instructions,
      items: sanitizedItems,
      tools: input.tools,
      maxOutputTokens: input.maxOutputTokens,
      onText: input.onText,
      signal: input.signal,
      forced: true,
    })
  }

  const agentResponse = withStageUsage(await legacyRequestGeminiResponse({
    ...input,
    model: GEMINI_AGENT_MODEL,
    instructions: `${input.instructions}\n\n${costGuardAgentInstruction({ budget: toolBudget, executed: executedTools, plan })}`,
    items: compactGeminiAgentItems(sanitizedItems),
    allowTools: true,
    maxOutputTokens: Math.min(input.maxOutputTokens, 900),
    onText: () => {},
  }), 'agent', { cost_guard_agent_calls: 1 })

  if (responseHasFunctionCall(agentResponse)) return agentResponse

  const draft = responseVisibleText(agentResponse)
  if (String(agentResponse.model || '') !== GEMINI_AGENT_MODEL || requestedModel === GEMINI_AGENT_MODEL) {
    if (draft) input.onText(draft)
    return agentResponse
  }

  return finalizeWithRequestedModel({
    apiKey: input.apiKey,
    requestedModel,
    instructions: input.instructions,
    items: sanitizedItems,
    tools: input.tools,
    maxOutputTokens: input.maxOutputTokens,
    onText: input.onText,
    signal: input.signal,
    agentDraft: draft,
    priorUsage: agentResponse.usage,
  })
}

export const cleanProviderItemsForOpenAi = (
  items: Array<Record<string, unknown>>,
) => {
  const cleaned = sanitizeItems(items).map(item => {
    const { _geminiContent: _metadata, _geminiSkipContent: _skip, ...clean } = item
    return clean
  })
  const enumerationDispatch = buildEnumerationFastPathDispatch(items)
  return enumerationDispatch
    ? [...cleaned, buildOpenAiEnumerationFastPathMarkerItem(enumerationDispatch)]
    : cleaned
}
