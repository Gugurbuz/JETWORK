import {
  requestGeminiResponse as baseRequestGeminiResponse,
  type NormalizedModelResponse,
} from './modelProvidersBase.ts'
import { extractSemanticPlanFromItems } from './geminiCostGuard.ts'
import { runDeterministicGeminiWebResearch } from './deterministicGeminiWebResearch.ts'
import { createStreamingProviderAnswerabilityGuard } from './providerAnswerabilityGuard.ts'

export * from './modelProvidersBase.ts'

const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
const UNTRUSTED_EVIDENCE_PATTERN = /\[UNTRUSTED_EVIDENCE\]\s*([\s\S]*?)\s*\[END_UNTRUSTED_EVIDENCE\]/i
const INTERNAL_SEMANTIC_PLAN_PATTERN = /\[JETWORK_SEMANTIC_PLAN\]\s*([\s\S]*?)\s*\[END_JETWORK_SEMANTIC_PLAN\]/i

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
  model: input.model,
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

const requestBaseWithStreamingAnswerability = async (input: {
  apiKey: string
  model: string
  instructions: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  allowProviderWeb?: boolean
  maxOutputTokens: number
  onText: (text: string) => void
  signal?: AbortSignal
}, plan = extractSemanticPlanFromItems(input.items)): Promise<NormalizedModelResponse> => {
  if (!plan || !shouldUseStreamingAnswerabilityGuard(plan)) return baseRequestGeminiResponse(input)

  const providerPlan = providerLocalStreamingPlan(input.items, plan)
  if (!providerPlan.changed) return baseRequestGeminiResponse(input)

  const guard = createStreamingProviderAnswerabilityGuard({
    requestText: answerabilityRequestText(plan),
    onText: input.onText,
  })
  const response = await baseRequestGeminiResponse({
    ...input,
    items: providerPlan.items,
    onText: delta => guard.push(delta),
  })
  guard.finish()
  const stats = guard.stats()

  return {
    ...response,
    usage: mergeNumericUsage(response.usage, {
      answerability_streaming_guard_used: 1,
      answerability_streaming_plan_override_applied: 1,
      answerability_streaming_segments_emitted: stats.emittedSegments,
      answerability_streaming_segments_removed: stats.removedSegments,
      answerability_streaming_identifiers_removed: stats.removedIdentifiers.length,
    }),
  }
}

export async function requestGeminiResponse(input: {
  apiKey: string
  model: string
  instructions: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  allowProviderWeb?: boolean
  maxOutputTokens: number
  onText: (text: string) => void
  signal?: AbortSignal
}): Promise<NormalizedModelResponse> {
  const plan = extractSemanticPlanFromItems(input.items)
  const providerWebRequested = input.allowProviderWeb ?? input.allowTools
  const deterministicDeepResearch = plan?.intent === 'research' && providerWebRequested

  if (!deterministicDeepResearch) return requestBaseWithStreamingAnswerability(input, plan)

  const target = researchTarget(plan)
  const web = await runDeterministicGeminiWebResearch({
    apiKey: input.apiKey,
    query: target || 'Kullanıcının Deep Research talebi için güncel ve güvenilir web kaynaklarını araştır.',
    complexity: plan?.complexity,
    signal: input.signal,
  })

  if (web.searchCount < 1) {
    const text = 'Deep Research için zorunlu Google Search executor çalıştı ancak gerçek bir arama çağrısı doğrulanamadı. Web araştırmasını tamamlanmış saymıyorum.'
    input.onText(text)
    return deterministicMissResponse({ model: input.model, text, usage: web.usage, searchQueries: web.searchQueries })
  }

  if (!web.sources.length) {
    const text = 'Google Search gerçekten çalıştı ancak bu araştırma hedefi için doğrulanabilir web kaynağı dönmedi. Kurumsal veya teknik ayrıntıları kaynak yokken uydurmuyorum.'
    input.onText(text)
    return deterministicMissResponse({ model: input.model, text, usage: web.usage, searchQueries: web.searchQueries })
  }

  const sourceList = web.sources
    .map((source, index) => `${index + 1}. ${source.title} — ${source.url}${source.snippet ? `\n   ${source.snippet}` : ''}`)
    .join('\n')
  const knowledgeEvidence = inlineKnowledgeEvidence(input.instructions)
  const evidenceItem = {
    role: 'user',
    content: [
      '[JETWORK_DETERMINISTIC_DEEP_RESEARCH_EVIDENCE]',
      `Research target: ${target}`,
      knowledgeEvidence ? `[JETWORK_PRIOR_KNOWLEDGE_EVIDENCE]\n${knowledgeEvidence}\n[END_JETWORK_PRIOR_KNOWLEDGE_EVIDENCE]` : '',
      web.text,
      `Citable web sources:\n${sourceList}`,
      '[END_JETWORK_DETERMINISTIC_DEEP_RESEARCH_EVIDENCE]',
    ].filter(Boolean).join('\n\n').slice(0, 42_000),
  }

  const finalInstructions = [
    input.instructions.replaceAll(PROVIDER_WEB_CAPABILITY_MARKER, '').replace(UNTRUSTED_EVIDENCE_PATTERN, ''),
    '[JETWORK DETERMINISTIC DEEP RESEARCH SYNTHESIS]',
    'Google Search executor already ran before this synthesis. Do NOT perform another web search and do not call tools.',
    'Use only the supplied deterministic web evidence and any supplied JetWork knowledge evidence for factual claims.',
    'For private/enterprise identifiers, public web evidence is not authoritative proof of internal behavior. If enterprise evidence is missing, say so explicitly.',
    'When citing web evidence, cite only the exact URLs supplied in JETWORK_DETERMINISTIC_DEEP_RESEARCH_EVIDENCE. Never invent a URL.',
  ].filter(Boolean).join('\n\n')

  const finalItems = [
    ...input.items.map(item => stripProviderWebMarker(item) as Record<string, unknown>),
    evidenceItem,
  ]

  const finalResponse = await requestBaseWithStreamingAnswerability({
    ...input,
    instructions: finalInstructions,
    items: finalItems,
    tools: [],
    allowTools: false,
    allowProviderWeb: false,
  }, plan)

  return {
    ...finalResponse,
    webSources: web.sources.map(source => ({ title: source.title, url: source.url })),
    webSearchQueries: web.searchQueries,
    usage: mergeNumericUsage(web.usage, finalResponse.usage, {
      deterministic_deep_research_used: 1,
      deterministic_web_source_count: web.sources.length,
      deterministic_web_search_count: web.searchCount,
    }),
  }
}
