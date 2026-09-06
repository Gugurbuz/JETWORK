import {
  providerForModel as baseProviderForModel,
  requestGeminiResponse as baseRequestGeminiResponse,
  type NormalizedModelResponse,
} from './modelProvidersBase.ts'
import { extractSemanticPlanFromItems } from './geminiCostGuard.ts'
import { createStreamingProviderAnswerabilityGuard } from './providerAnswerabilityGuard.ts'
import { replaceProviderResponseVisibleText } from './providerResponseText.ts'
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

const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
const UNTRUSTED_EVIDENCE_PATTERN = /\[UNTRUSTED_EVIDENCE\]\s*([\s\S]*?)\s*\[END_UNTRUSTED_EVIDENCE\]/i
const INTERNAL_SEMANTIC_PLAN_PATTERN = /\[JETWORK_SEMANTIC_PLAN\]\s*([\s\S]*?)\s*\[END_JETWORK_SEMANTIC_PLAN\]/i
const VERIFIED_KNOWLEDGE_EVIDENCE_MARKER = 'VERIFIED_KNOWLEDGE_EVIDENCE'

const mergeNumericUsage = (...values: Array<Record<string, number> | undefined>): Record<string, number> => {
  const merged: Record<string, number> = {}
  for (const value of values) {
    for (const [key, raw] of Object.entries(value || {})) {
      const amount = Number(raw)
      if (Number.isFinite(amount)) merged[key] = (merged[key] || 0) + amount
    }
  }
  return merged
}

const stripProviderWebMarker = (value: unknown): unknown => {
  if (typeof value === 'string') return value.replaceAll(PROVIDER_WEB_CAPABILITY_MARKER, '')
  if (Array.isArray(value)) return value.map(stripProviderWebMarker)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, stripProviderWebMarker(nested)]))
}

const researchTarget = (plan: ReturnType<typeof extractSemanticPlanFromItems>) => [
  String(plan?.conversationState?.resolvedRequest || '').trim(),
  String(plan?.goal || '').replaceAll(PROVIDER_WEB_CAPABILITY_MARKER, '').trim(),
].filter(Boolean).join('\n').slice(0, 2_000)

const answerabilityRequestText = (plan: ReturnType<typeof extractSemanticPlanFromItems>) => [
  String(plan?.conversationState?.resolvedRequest || ''),
  String(plan?.goal || '').replaceAll(PROVIDER_WEB_CAPABILITY_MARKER, ''),
].filter(Boolean).join('\n')

const inlineKnowledgeEvidence = (instructions: string) => {
  const match = instructions.match(UNTRUSTED_EVIDENCE_PATTERN)
  return String(match?.[1] || '').trim().slice(0, 20_000)
}

const deterministicMissResponse = (input: {
  model: string
  text: string
  usage?: Record<string, number>
  searchQueries: string[]
}): NormalizedModelResponse => ({
  id: `jetwork-deterministic-web:${crypto.randomUUID()}`,
  status: 'completed',
  model: PUBLIC_GEMINI_MODEL,
  output: [{
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: input.text, annotations: [] }],
  }],
  webSources: [],
  webSearchQueries: input.searchQueries,
  usage: mergeNumericUsage(input.usage, {
    deterministic_deep_research_used: 1,
    deterministic_web_source_count: 0,
  }),
})

const rewriteSemanticPlanContent = (
  content: unknown,
  replacementBlock: string,
): { content: unknown; changed: boolean } => {
  if (typeof content === 'string') {
    if (!INTERNAL_SEMANTIC_PLAN_PATTERN.test(content)) return { content, changed: false }
    return { content: content.replace(INTERNAL_SEMANTIC_PLAN_PATTERN, replacementBlock), changed: true }
  }
  if (!Array.isArray(content)) return { content, changed: false }

  let changed = false
  const next = content.map(part => {
    if (changed || !part || typeof part !== 'object') return part
    const candidate = part as Record<string, unknown>
    if (typeof candidate.text !== 'string' || !INTERNAL_SEMANTIC_PLAN_PATTERN.test(candidate.text)) return part
    changed = true
    return {
      ...candidate,
      text: candidate.text.replace(INTERNAL_SEMANTIC_PLAN_PATTERN, replacementBlock),
    }
  })
  return { content: changed ? next : content, changed }
}

/**
 * The base provider historically disables streaming for knowledgeRequired turns
 * so it can batch-sanitize novel custom identifiers. The outer wrapper now owns
 * that sanitization incrementally. For this provider call only, mark the copied
 * plan as enterprise-grounded so the legacy batch buffer does not swallow the
 * real Gemini stream. The original reasoning plan and downstream grounding
 * boundary are never mutated.
 */
const providerLocalStreamingPlan = (
  items: Array<Record<string, unknown>>,
  plan: NonNullable<ReturnType<typeof extractSemanticPlanFromItems>>,
): { items: Array<Record<string, unknown>>; changed: boolean } => {
  const replacementBlock = `[JETWORK_SEMANTIC_PLAN]\n${JSON.stringify({
    ...plan,
    enterpriseGroundingRequired: true,
  })}\n[END_JETWORK_SEMANTIC_PLAN]`

  const next = [...items]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const rewritten = rewriteSemanticPlanContent(next[index].content, replacementBlock)
    if (!rewritten.changed) continue
    next[index] = { ...next[index], content: rewritten.content }
    return { items: next, changed: true }
  }
  return { items, changed: false }
}

const shouldUseStreamingAnswerabilityGuard = (plan: ReturnType<typeof extractSemanticPlanFromItems>) => (
  Boolean(plan?.knowledgeRequired) && plan?.enterpriseGroundingRequired !== true
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

const requestTimedGeminiBase = async (input: GeminiRequestInput): Promise<NormalizedModelResponse> => {
  const startedAt = performance.now()
  let firstTextAt: number | null = null
  let emittedText = ''
  const response = await baseRequestGeminiResponse({
    ...input,
    model: PUBLIC_GEMINI_MODEL,
    onText: delta => {
      if (firstTextAt == null && delta) firstTextAt = performance.now()
      if (delta) emittedText += delta
      input.onText(delta)
    },
  })
  const completedAt = performance.now()
  const alignedResponse = emittedText.trim()
    ? replaceProviderResponseVisibleText(response, emittedText)
    : response
  return {
    ...alignedResponse,
    model: PUBLIC_GEMINI_MODEL,
    usage: mergeNumericUsage(response.usage, {
      gemini_provider_total_ms: Math.max(0, Math.round(completedAt - startedAt)),
      ...(firstTextAt == null ? {} : {
        gemini_provider_first_text_ms: Math.max(0, Math.round(firstTextAt - startedAt)),
      }),
    }),
  }
}

const requestBaseWithStreamingAnswerability = async (
  input: GeminiRequestInput,
  plan = extractSemanticPlanFromItems(input.items),
): Promise<NormalizedModelResponse> => {
  if (!plan || !shouldUseStreamingAnswerabilityGuard(plan)) return requestTimedGeminiBase(input)

  const providerPlan = providerLocalStreamingPlan(input.items, plan)
  if (!providerPlan.changed) return requestTimedGeminiBase(input)

  let guardedText = ''
  const guard = createStreamingProviderAnswerabilityGuard({
    requestText: answerabilityRequestText(plan),
    onText: text => {
      guardedText += text
      input.onText(text)
    },
  })
  const response = await requestTimedGeminiBase({
    ...input,
    items: providerPlan.items,
    onText: delta => guard.push(delta),
  })
  guard.finish()
  const stats = guard.stats()
  const alignedResponse = guardedText.trim()
    ? replaceProviderResponseVisibleText(response, guardedText)
    : response

  return {
    ...alignedResponse,
    usage: mergeNumericUsage(response.usage, {
      answerability_streaming_guard_used: 1,
      answerability_streaming_plan_override_applied: 1,
      answerability_streaming_segments_emitted: stats.emittedSegments,
      answerability_streaming_segments_removed: stats.removedSegments,
      answerability_streaming_identifiers_removed: stats.removedIdentifiers.length,
    }),
  }
}

const responseHasFunctionCall = (response: NormalizedModelResponse) => (
  Array.isArray(response.output) && response.output.some(item => item?.type === 'function_call')
)

const requestBaseWithEmptyFinalizationRecovery = async (
  input: GeminiRequestInput,
  plan = extractSemanticPlanFromItems(input.items),
): Promise<NormalizedModelResponse> => {
  let visibleText = ''
  const first = await requestBaseWithStreamingAnswerability({
    ...input,
    onText: delta => {
      if (delta) visibleText += delta
      input.onText(delta)
    },
  }, plan)

  if (visibleText.trim() || responseHasFunctionCall(first)) return first

  console.warn('JETWORK_GEMINI_EMPTY_FINALIZATION_RETRY', JSON.stringify({ model: PUBLIC_GEMINI_MODEL }))
  let retryVisibleText = ''
  const retry = await requestBaseWithStreamingAnswerability({
    ...input,
    instructions: [
      input.instructions,
      '[JETWORK EMPTY FINALIZATION RECOVERY]',
      'No further tools are allowed in this recovery turn.',
      'Produce a user-visible final answer now using only the verified observations and evidence already present in the supplied items.',
      'If the evidence is incomplete, state exactly what is verified and what remains unverified. Do not invent technical facts.',
    ].filter(Boolean).join('\n\n'),
    tools: [],
    allowTools: false,
    allowProviderWeb: false,
    onText: delta => {
      if (delta) retryVisibleText += delta
      input.onText(delta)
    },
  }, plan)

  return {
    ...retry,
    usage: mergeNumericUsage(first.usage, retry.usage, {
      gemini_empty_finalization_retry: 1,
      gemini_empty_finalization_retry_text_emitted: retryVisibleText.trim() ? 1 : 0,
    }),
  }
}

const itemsContainVerifiedKnowledgeEvidence = (items: Array<Record<string, unknown>>) => {
  for (const item of items) {
    if (String(item.type || '') !== 'function_call_output') continue
    const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
    if (!output.includes(VERIFIED_KNOWLEDGE_EVIDENCE_MARKER)) continue
    try {
      const parsed = JSON.parse(output)
      if (parsed?.citationReady === true) return true
    } catch {
      // Verified tool envelopes can be compacted/annotated. The marker alone is
      // accepted only together with an explicit citationReady literal.
      if (/"citationReady"\s*:\s*true/u.test(output)) return true
    }
  }
  return false
}

const shouldRunEnterpriseEvidenceReplan = (input: {
  request: GeminiRequestInput
  plan: ReturnType<typeof extractSemanticPlanFromItems>
  response: NormalizedModelResponse
  visibleText: string
}) => Boolean(
  input.plan?.enterpriseGroundingRequired === true
  && input.request.allowTools
  && input.request.tools.length > 0
  && input.visibleText.trim()
  && !responseHasFunctionCall(input.response)
  && !itemsContainVerifiedKnowledgeEvidence(input.request.items)
)

/**
 * Mechanical grounding recovery for Controller V2.
 *
 * When authoritative enterprise evidence is required but the controller attempts
 * to finalize before any citation-ready enterprise observation exists, the first
 * draft is withheld and the same controller model gets one structured recovery
 * observation with the SAME capability surface. Runtime does not select a tool;
 * the LLM may choose knowledge, web, discovery, another visible capability, or
 * (after reconsideration) an evidence-gap final. The downstream fail-closed
 * grounding guard remains authoritative if the retry still lacks support.
 */
const requestBaseWithEnterpriseEvidenceReplan = async (
  input: GeminiRequestInput,
  plan = extractSemanticPlanFromItems(input.items),
): Promise<NormalizedModelResponse> => {
  if (plan?.enterpriseGroundingRequired !== true || !input.allowTools || input.tools.length === 0) {
    return requestBaseWithEmptyFinalizationRecovery(input, plan)
  }

  let withheldText = ''
  const first = await requestBaseWithEmptyFinalizationRecovery({
    ...input,
    onText: delta => { if (delta) withheldText += delta },
  }, plan)

  if (!shouldRunEnterpriseEvidenceReplan({ request: input, plan, response: first, visibleText: withheldText })) {
    if (withheldText) input.onText(withheldText)
    return first
  }

  console.warn('JETWORK_GEMINI_ENTERPRISE_GROUNDING_REPLAN', JSON.stringify({
    model: PUBLIC_GEMINI_MODEL,
    visibleTools: input.tools.length,
  }))

  let retryText = ''
  const retry = await requestBaseWithEmptyFinalizationRecovery({
    ...input,
    instructions: [
      input.instructions,
      '[JETWORK GROUNDING RECOVERY REPLAN OBSERVATION]',
      'Önceki final taslak kullanıcıya gönderilmedi: bu turn authoritative enterprise evidence gerektiriyor ve henüz citation-ready enterprise evidence yok.',
      'Bu observation bir tool seçimi değildir. Kullanıcı hedefini ve mevcut observationları yeniden değerlendir; sıradaki capability/tool kararını yine sen ver.',
      'Search sonucu candidate-only ise onu kanıt sayma. Pending canonical candidate varsa exact/detail doğrulama protokolünü tamamla. Güncel dış doğrulama değerliyse görünür web capabilitysini seçebilirsin.',
      'Mekanik bütçe bitmeden yalnız aynı doğrulanmamış finali tekrar etme. Ek araştırmanın artık değer üretmeyeceğine karar verirsen kanıt açığını açıkça belirten dürüst bir final üret.',
    ].filter(Boolean).join('\n\n'),
    onText: delta => { if (delta) retryText += delta },
  }, plan)

  if (retryText) input.onText(retryText)
  return {
    ...retry,
    usage: mergeNumericUsage(first.usage, retry.usage, {
      grounding_controller_replan_retry: 1,
      grounding_controller_replan_withheld_first_draft: withheldText.trim() ? 1 : 0,
    }),
  }
}

export async function requestGeminiResponse(input: GeminiRequestInput): Promise<NormalizedModelResponse> {
  // Provider-native web is exposed as a capability. The active Gemini controller
  // decides whether to use Google Search; no semantic intent gate executes web first.
  return requestBaseWithEnterpriseEvidenceReplan(input, extractSemanticPlanFromItems(input.items))
}
