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
  compactGeminiAgentItems,
  extractSemanticPlanFromItems,
  normalizeGeminiRequestedModel,
  usageWithGeminiEstimatedCost,
} from './geminiCostGuard.ts'
import { assertExplicitGeminiModelPreserved } from './geminiProviderLock.ts'
import { compactAssistantConversationMemory } from './conversationMemory.ts'
import {
  buildResolvedConversationInstruction,
  compactResolvedConversationItems,
  type ResolvedConversationContextSeed,
} from './resolvedConversationContext.ts'
import { composeAssistantPrompt } from './assistantPromptProfiles.ts'
import { baAnalysisInstructionForPlan } from './baAnalysisContract.ts'
import { sanitizeNovelCustomIdentifierClaims } from './providerAnswerabilityGuard.ts'
import { AGENT_CONTROLLER_INSTRUCTION } from './agentControllerPolicy.ts'

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
const INTERNAL_EVIDENCE_PATTERN = /\n?\[UNTRUSTED_EVIDENCE\][\s\S]*?\[END_UNTRUSTED_EVIDENCE\]\s*/gi
const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
const VERIFIED_EVIDENCE_MARKER = 'VERIFIED_KNOWLEDGE_EVIDENCE'
const KNOWLEDGE_TOOL_NAMES = new Set([
  'search_knowledge_catalog',
  'list_knowledge_catalog',
  'list_class_inventory',
  'get_abap_source',
  'get_message_detail',
  'search_document',
  'get_document_content',
  'get_knowledge_object',
  'get_related_objects',
])

export const stripInternalSemanticPlan = (value: string) => value
  .replace(INTERNAL_SEMANTIC_PLAN_PATTERN, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

export const stripDuplicatedInlineEvidence = (value: string) => value
  .replace(INTERNAL_EVIDENCE_PATTERN, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const sanitizeProviderInstructions = (value: string) => stripDuplicatedInlineEvidence(stripInternalSemanticPlan(value))
const sanitizeTextContent = (value: string) => stripDuplicatedInlineEvidence(stripInternalSemanticPlan(value))

const sanitizeContent = (content: unknown): unknown => {
  if (typeof content === 'string') return sanitizeTextContent(content)
  if (!Array.isArray(content)) return content
  return content.map(part => {
    if (typeof part === 'string') return sanitizeTextContent(part)
    if (!part || typeof part !== 'object') return part
    const clean = { ...(part as Record<string, unknown>) }
    if (typeof clean.text === 'string') clean.text = sanitizeTextContent(clean.text)
    return clean
  })
}

const compactAssistantContent = (content: unknown): unknown => {
  if (typeof content === 'string') return compactAssistantConversationMemory(content, 800)
  if (!Array.isArray(content)) return content
  const text = content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    return typeof (part as Record<string, unknown>).text === 'string'
      ? String((part as Record<string, unknown>).text)
      : ''
  }).filter(Boolean).join('\n')
  return text ? compactAssistantConversationMemory(text, 800) : content
}

const sanitizeItems = (items: Array<Record<string, unknown>>) => items.map(item => {
  const clean = { ...item }
  if ('content' in clean) clean.content = sanitizeContent(clean.content)
  if (String(clean.role || '') === 'assistant' && 'content' in clean) clean.content = compactAssistantContent(clean.content)
  return clean
})

export const countExecutedKnowledgeToolCalls = (items: Array<Record<string, unknown>>): number => {
  const namesByCallId = new Map<string, string>()
  let count = 0
  for (const item of items) {
    const type = String(item.type || '')
    const callId = String(item.call_id || '')
    if (type === 'function_call') {
      namesByCallId.set(callId, String(item.name || ''))
      continue
    }
    if (type === 'function_call_output' && KNOWLEDGE_TOOL_NAMES.has(namesByCallId.get(callId) || '')) count += 1
  }
  return count
}

const responseHasFunctionCall = (response: NormalizedModelResponse): boolean => (
  (response.output || []).some(item => item.type === 'function_call')
)

const responseHasVisibleText = (response: NormalizedModelResponse): boolean => (
  (response.output || []).some(item => {
    if (item.type !== 'message' || !Array.isArray(item.content)) return false
    return (item.content as Array<Record<string, unknown>>).some(part => (
      typeof part.text === 'string' && String(part.text).trim().length > 0
    ))
  })
)

export const responseHasProviderWebEvidence = (response: NormalizedModelResponse): boolean => (
  Boolean(response.webSources?.length)
)

export const responseHasProviderWebExecution = (response: NormalizedModelResponse): boolean => (
  responseHasProviderWebEvidence(response) || Boolean(response.webSearchQueries?.length)
)

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

const resolvedContextSeedForPlan = (plan: ReturnType<typeof extractSemanticPlanFromItems>): ResolvedConversationContextSeed => ({
  resolvedRequest: String(plan?.conversationState?.resolvedRequest || plan?.goal || '').trim() || undefined,
  topic: String(plan?.conversationState?.topic || '').trim() || undefined,
  activeEntities: plan?.conversationState?.activeEntities || [],
  userDecisions: plan?.conversationState?.userDecisions || [],
  rejectedScopes: plan?.conversationState?.rejectedScopes || [],
  rejectedHypotheses: plan?.conversationState?.rejectedHypotheses || [],
  openQuestions: plan?.conversationState?.openQuestions || [],
  retainedContext: plan?.conversationState?.retainedContext || [],
  verifiedFactRefs: plan?.conversationState?.verifiedFactRefs || [],
})

const resolvedProviderItems = (
  items: Array<Record<string, unknown>>,
  plan: ReturnType<typeof extractSemanticPlanFromItems>,
) => compactResolvedConversationItems(sanitizeItems(items), resolvedContextSeedForPlan(plan))

const toolEvidenceAsUserItem = (items: Array<Record<string, unknown>>): Record<string, unknown> | null => {
  const namesByCallId = new Map<string, string>()
  const evidence: string[] = []
  for (const item of items) {
    const type = String(item.type || '')
    const callId = String(item.call_id || '')
    if (type === 'function_call') {
      namesByCallId.set(callId, String(item.name || 'tool'))
      continue
    }
    if (type !== 'function_call_output') continue
    const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
    if (!output.trim()) continue
    evidence.push(`[${namesByCallId.get(callId) || 'tool'}]\n${output.trim()}`)
  }
  if (!evidence.length) return null
  return {
    role: 'user',
    content: `[JETWORK_TOOL_EVIDENCE]\n${evidence.join('\n\n').slice(0, 14_000)}\n[END_JETWORK_TOOL_EVIDENCE]`,
  }
}

const buildNoToolRecoveryItems = (
  items: Array<Record<string, unknown>>,
  plan: ReturnType<typeof extractSemanticPlanFromItems>,
) => {
  const sanitized = resolvedProviderItems(items, plan)
    .filter(item => !['function_call', 'function_call_output'].includes(String(item.type || '')))
  const evidenceItem = toolEvidenceAsUserItem(items)
  return evidenceItem ? [...sanitized, evidenceItem] : sanitized
}

const parseVerifiedToolOutput = (value: unknown): string => {
  const output = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  if (!output.trim()) return ''
  try {
    const parsed = JSON.parse(output)
    if (
      parsed?.citationReady === true
      && String(parsed?.securityNotice || '').includes(VERIFIED_EVIDENCE_MARKER)
    ) return output
  } catch { /* ignore malformed output */ }
  return ''
}

const derivedAbapMessageCodes = (value: string) => {
  const codes = new Set<string>()
  for (const match of value.matchAll(/\bMESSAGE\s+[A-Z]?(\d{2,4})\(([A-Z][A-Z0-9_]*)\)/gi)) {
    const number = String(match[1] || '')
    const messageClass = String(match[2] || '').toLocaleUpperCase('en-US')
    if (number && messageClass) codes.add(`${messageClass}-${number}`)
  }
  return [...codes]
}

export const verifiedToolEvidenceForAnswerability = (items: Array<Record<string, unknown>>) => {
  const chunks: string[] = []
  for (const item of items) {
    if (String(item.type || '') !== 'function_call_output') continue
    const output = parseVerifiedToolOutput(item.output)
    if (!output) continue
    const derived = derivedAbapMessageCodes(output)
    chunks.push(output.toLocaleUpperCase('en-US'))
    if (derived.length) chunks.push(derived.join(' '))
  }
  return chunks.join('\n').slice(0, 28_000)
}

const answerabilityRequestText = (
  plan: ReturnType<typeof extractSemanticPlanFromItems>,
  items: Array<Record<string, unknown>>,
) => [
  String(plan?.conversationState?.resolvedRequest || ''),
  String(plan?.goal || '').replace(PROVIDER_WEB_CAPABILITY_MARKER, ''),
  verifiedToolEvidenceForAnswerability(items),
].filter(Boolean).join('\n')

const shouldBufferForAnswerabilityGuard = (
  plan: ReturnType<typeof extractSemanticPlanFromItems>,
  executedKnowledgeCalls: number,
) => executedKnowledgeCalls > 0 || (
  Boolean(plan?.knowledgeRequired) && plan?.enterpriseGroundingRequired !== true
)

const buildGroundedRevisionItems = (
  items: Array<Record<string, unknown>>,
  plan: ReturnType<typeof extractSemanticPlanFromItems>,
  draft: string,
  removedIdentifiers: string[],
) => {
  const conversational = resolvedProviderItems(items, plan)
    .filter(item => !['function_call', 'function_call_output'].includes(String(item.type || '')))
  const verifiedEvidence = verifiedToolEvidenceForAnswerability(items)
  return [
    ...conversational,
    {
      role: 'user',
      content: [
        '[JETWORK_GROUNDED_REVISION_OBSERVATION]',
        'Önceki taslakta verified evidence dışında kalan teknik identifier bulundu. Bu bir runtime grounding observationıdır; yeni araç çağırma.',
        removedIdentifiers.length ? `Kaldırılması gereken unsupported identifierlar: ${removedIdentifiers.join(', ')}` : '',
        verifiedEvidence ? `[VERIFIED_EVIDENCE_FOR_REVISION]\n${verifiedEvidence}\n[END_VERIFIED_EVIDENCE_FOR_REVISION]` : '',
        `[REJECTED_DRAFT]\n${String(draft || '').slice(0, 4_000)}\n[END_REJECTED_DRAFT]`,
        'Aynı kullanıcı hedefini yalnız verified evidence ve kullanıcının açıkça verdiği bilgilerle yeniden cevapla. Unsupported identifierları ve bunlara bağlı doğrulanmamış iddiaları çıkar. Verified evidence soruyu doğrudan cevaplıyorsa kullanıcıdan o bilgiyi yeniden isteme. Kanıt gerçekten yetmiyorsa eksikliği açıkça söyle.',
      ].filter(Boolean).join('\n\n'),
    },
  ]
}

const shouldRunGroundedRevision = (input: {
  bufferForAnswerability: boolean
  executedKnowledgeCalls: number
  firstProviderText: string
  sanitizedText: string
  hasFunctionCall: boolean
}) => Boolean(
  input.bufferForAnswerability
  && input.executedKnowledgeCalls > 0
  && input.firstProviderText.trim()
  && input.sanitizedText !== input.firstProviderText
  && !input.hasFunctionCall
)

export const isTrivialConversationalTurn = (items: Array<Record<string, unknown>>) => legacyIsTrivialConversationalTurn(sanitizeItems(items))

const primaryAgentInstruction = AGENT_CONTROLLER_INSTRUCTION

const openAiPrimaryAgentDeveloperItem = (items: Array<Record<string, unknown>>) => {
  const plan = extractSemanticPlanFromItems(items)
  const resolvedConversationInstruction = buildResolvedConversationInstruction(resolvedContextSeedForPlan(plan))
  return {
    type: 'message',
    role: 'developer',
    content: [
      primaryAgentInstruction,
      baAnalysisInstructionForPlan(plan),
      resolvedConversationInstruction,
      'Semantic plan alanları advisory contexttir. Uygun tool/capability seçimini aktif controller modeli yapar; intent veya önceden hesaplanmış route bir capabilityyi semantik olarak yasaklamaz.',
    ].filter(Boolean).join('\n\n'),
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
  const requestedModel = normalizeGeminiRequestedModel(input.model)
  const plan = extractSemanticPlanFromItems(input.items)
  const baAnalysisInstruction = baAnalysisInstructionForPlan(plan)
  const executedKnowledgeCalls = countExecutedKnowledgeToolCalls(input.items)
  const contextSeed = resolvedContextSeedForPlan(plan)
  const resolvedConversationInstruction = buildResolvedConversationInstruction(contextSeed)
  const compactedProviderItems = compactResolvedConversationItems(sanitizeItems(input.items), contextSeed)

  // Tool availability is intentionally broad. The active LLM decides whether
  // knowledge, skills or provider-native web are useful on each round.
  const providerWebEnabled = input.allowProviderWeb ?? input.allowTools
  const effectiveAllowTools = input.allowTools && (input.tools.length > 0 || providerWebEnabled)
  const providerInstructions = composeAssistantPrompt(sanitizeProviderInstructions(input.instructions), plan)
  const geminiInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    baAnalysisInstruction,
    resolvedConversationInstruction,
    effectiveAllowTools && providerWebEnabled ? PROVIDER_WEB_CAPABILITY_MARKER : '',
  ].filter(Boolean).join('\n\n')

  const bufferForAnswerability = shouldBufferForAnswerabilityGuard(plan, executedKnowledgeCalls)
  const answerabilityContext = answerabilityRequestText(plan, input.items)
  let firstProviderText = ''
  const firstResponse = await legacyRequestGeminiResponse({
    ...input,
    model: requestedModel,
    instructions: geminiInstructions,
    items: effectiveAllowTools
      ? compactGeminiAgentItems(compactedProviderItems)
      : compactedProviderItems,
    tools: effectiveAllowTools ? input.tools : [],
    allowTools: effectiveAllowTools,
    onText: delta => {
      if (bufferForAnswerability) firstProviderText += delta
      else input.onText(delta)
    },
  })
  assertExplicitGeminiModelPreserved(requestedModel, firstResponse.model)

  const answerability = bufferForAnswerability
    ? sanitizeNovelCustomIdentifierClaims(firstProviderText, answerabilityContext)
    : { text: firstProviderText, removedSegments: 0, removedIdentifiers: [] as string[] }
  const firstHasFunctionCall = responseHasFunctionCall(firstResponse)

  const firstUsage = usageWithGeminiEstimatedCost(String(firstResponse.model || requestedModel), firstResponse.usage, {
    primary_llm_agent_calls: effectiveAllowTools ? 1 : 0,
    primary_llm_final_calls: effectiveAllowTools ? 0 : 1,
    agent_controller_context_compacted_calls: compactedProviderItems.length < input.items.length ? 1 : 0,
    agent_controller_context_items_before: input.items.length,
    agent_controller_context_items_after: compactedProviderItems.length,
    agent_controller_knowledge_tool_calls_seen: executedKnowledgeCalls,
    ...(providerWebEnabled ? { agent_controller_provider_web_available: 1 } : {}),
    ...(answerability.text !== firstProviderText ? {
      grounding_preflight_custom_identifier_segments_removed: answerability.removedSegments,
      grounding_preflight_custom_identifiers_removed: answerability.removedIdentifiers.length,
    } : {}),
  })

  if (shouldRunGroundedRevision({
    bufferForAnswerability,
    executedKnowledgeCalls,
    firstProviderText,
    sanitizedText: answerability.text,
    hasFunctionCall: firstHasFunctionCall,
  })) {
    const revisionInstructions = [
      providerInstructions,
      primaryAgentInstruction,
      baAnalysisInstruction,
      resolvedConversationInstruction,
      '[JETWORK GROUNDED REVISION]',
      'Önceki provider taslağı runtime grounding preflight kontrolünde kısmen reddedildi. Yeni tool çağırma. Mevcut verified evidence ile kullanıcıya doğrudan, kısa ve kanıtlı bir cevap yeniden yaz. Runtime observationında unsupported olarak belirtilen teknik identifierları kullanma. Verified exact evidence kullanıcının istediği bilgiyi zaten içeriyorsa clarification sorma.',
    ].filter(Boolean).join('\n\n')
    let revisionProviderText = ''
    try {
      const revisionResponse = await legacyRequestGeminiResponse({
        ...input,
        model: requestedModel,
        instructions: revisionInstructions,
        items: buildGroundedRevisionItems(input.items, plan, firstProviderText, answerability.removedIdentifiers),
        tools: [],
        allowTools: false,
        onText: delta => { revisionProviderText += delta },
      })
      assertExplicitGeminiModelPreserved(requestedModel, revisionResponse.model)
      const revisionAnswerability = sanitizeNovelCustomIdentifierClaims(revisionProviderText, answerabilityContext)
      const revisionText = revisionAnswerability.text.trim()
      if (revisionText) {
        input.onText(revisionText)
        const revisionUsage = usageWithGeminiEstimatedCost(String(revisionResponse.model || requestedModel), revisionResponse.usage, {
          primary_llm_agent_calls: 0,
          primary_llm_final_calls: 1,
          grounding_preflight_revision_used: 1,
          grounding_preflight_revision_source_segments_removed: answerability.removedSegments,
          grounding_preflight_revision_source_identifiers_removed: answerability.removedIdentifiers.length,
          ...(revisionAnswerability.text !== revisionProviderText ? {
            grounding_preflight_revision_segments_removed: revisionAnswerability.removedSegments,
            grounding_preflight_revision_identifiers_removed: revisionAnswerability.removedIdentifiers.length,
          } : {}),
        })
        return {
          ...revisionResponse,
          usage: mergeNumericUsage(firstUsage, revisionUsage),
        }
      }
    } catch {
      // Fail back to the already-sanitized first draft. The downstream authoritative
      // grounding boundary still decides whether that text is safe to finalize.
    }
  }

  if (bufferForAnswerability && firstProviderText) input.onText(answerability.text)

  if (firstHasFunctionCall || responseHasVisibleText(firstResponse)) {
    return { ...firstResponse, usage: firstUsage }
  }

  // Provider transport recovery only. It does not choose a semantic route.
  const recoveryInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    baAnalysisInstruction,
    resolvedConversationInstruction,
    '[JETWORK EMPTY FINAL RECOVERY]',
    'Önceki deneme kullanıcıya görünür bir yanıt üretmedi. Bu son transport-recovery denemesinde yeni araç çağırma; mevcut kullanıcı mesajını ve varsa tool observationlarını kullanarak dürüst nihai yanıt üret. Kanıt eksikse bunu açıkça belirt.',
  ].join('\n\n')
  let recoveryProviderText = ''
  const recoveryResponse = await legacyRequestGeminiResponse({
    ...input,
    model: requestedModel,
    instructions: recoveryInstructions,
    items: buildNoToolRecoveryItems(input.items, plan),
    tools: [],
    allowTools: false,
    onText: delta => {
      if (bufferForAnswerability) recoveryProviderText += delta
      else input.onText(delta)
    },
  })
  assertExplicitGeminiModelPreserved(requestedModel, recoveryResponse.model)
  const recoveryAnswerability = bufferForAnswerability
    ? sanitizeNovelCustomIdentifierClaims(recoveryProviderText, answerabilityContext)
    : { text: recoveryProviderText, removedSegments: 0, removedIdentifiers: [] as string[] }
  if (bufferForAnswerability && recoveryProviderText) input.onText(recoveryAnswerability.text)
  const recoveryUsage = usageWithGeminiEstimatedCost(String(recoveryResponse.model || requestedModel), recoveryResponse.usage, {
    primary_llm_agent_calls: 0,
    primary_llm_final_calls: 1,
    gemini_empty_final_retry: 1,
    ...(recoveryAnswerability.text !== recoveryProviderText ? {
      grounding_preflight_custom_identifier_segments_removed: recoveryAnswerability.removedSegments,
      grounding_preflight_custom_identifiers_removed: recoveryAnswerability.removedIdentifiers.length,
    } : {}),
  })
  return {
    ...recoveryResponse,
    usage: mergeNumericUsage(firstUsage, recoveryUsage),
  }
}

export const cleanProviderItemsForOpenAi = (items: Array<Record<string, unknown>>) => {
  const plan = extractSemanticPlanFromItems(items)
  const cleaned = resolvedProviderItems(items, plan).map(item => {
    const { _geminiContent: _metadata, _geminiSkipContent: _skip, ...clean } = item
    return clean
  })
  return [openAiPrimaryAgentDeveloperItem(items), ...cleaned]
}
