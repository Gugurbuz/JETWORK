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
  costGuardAgentInstruction,
  extractSemanticPlanFromItems,
  normalizeGeminiRequestedModel,
  toolBudgetForPlan,
  usageWithGeminiEstimatedCost,
} from './geminiCostGuard.ts'
import { assertExplicitGeminiModelPreserved } from './geminiProviderLock.ts'
import { compactAssistantConversationMemory } from './conversationMemory.ts'
import { composeAssistantPrompt } from './assistantPromptProfiles.ts'
import { baAnalysisInstructionForPlan } from './baAnalysisContract.ts'
import {
  findEmptyExactIdentifierPair,
  findEmptyMessageDetailNeedingCatalogCheck,
  hasEmptyMessageDetailLookup,
} from './exactIdentifierEarlyStop.ts'
import { sanitizeNovelCustomIdentifierClaims } from './providerAnswerabilityGuard.ts'
import {
  buildEnumerationFastPathDispatch,
  buildOpenAiEnumerationFastPathMarkerItem,
  buildSyntheticEnumerationFunctionCall,
} from './enumerationFastPath.ts'

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
const ENUMERATION_KNOWLEDGE_TOOLS = new Set(['list_knowledge_catalog', 'list_class_inventory'])
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
const MAX_EMPTY_KNOWLEDGE_SEARCHES = 2

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

const parseToolOutput = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const isEmptyKnowledgeSearchOutput = (value: unknown): boolean => {
  const parsed = parseToolOutput(value)
  if (!parsed) return false
  if (Array.isArray(parsed.records)) return parsed.records.length === 0
  const summary = parsed.summary && typeof parsed.summary === 'object' && !Array.isArray(parsed.summary)
    ? parsed.summary as Record<string, unknown>
    : undefined
  const rawCount = parsed.resultCount ?? summary?.resultCount
  return rawCount !== undefined && Number(rawCount) === 0
}

export const countEmptyKnowledgeSearches = (items: Array<Record<string, unknown>>): number => {
  const namesByCallId = new Map<string, string>()
  let emptySearches = 0
  for (const item of items) {
    const type = String(item.type || '')
    const callId = String(item.call_id || '')
    if (type === 'function_call') {
      namesByCallId.set(callId, String(item.name || ''))
      continue
    }
    if (
      type === 'function_call_output'
      && namesByCallId.get(callId) === 'search_knowledge_catalog'
      && isEmptyKnowledgeSearchOutput(item.output)
    ) emptySearches += 1
  }
  return emptySearches
}

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

const toolEvidenceAsUserItem = (items: Array<Record<string, unknown>>): Record<string, unknown> | null => {
  const namesByCallId = new Map<string, string>()
  const evidence: string[] = []
  for (const item of items) {
    const type = String(item.type || '')
    const callId = String(item.call_id || '')
    if (type === 'function_call') {
      namesByCallId.set(callId, String(item.name || 'knowledge_tool'))
      continue
    }
    if (type !== 'function_call_output') continue
    const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
    if (!output.trim()) continue
    evidence.push(`[${namesByCallId.get(callId) || 'knowledge_tool'}]\n${output.trim()}`)
  }
  if (!evidence.length) return null
  return {
    role: 'user',
    content: `[JETWORK_TOOL_EVIDENCE]\n${evidence.join('\n\n').slice(0, 14_000)}\n[END_JETWORK_TOOL_EVIDENCE]`,
  }
}

const buildNoToolRecoveryItems = (items: Array<Record<string, unknown>>) => {
  const sanitized = sanitizeItems(items).filter(item => !['function_call', 'function_call_output'].includes(String(item.type || '')))
  const evidenceItem = toolEvidenceAsUserItem(items)
  return evidenceItem ? [...sanitized, evidenceItem] : sanitized
}

const boundedKnowledgeToolBudget = (plan: ReturnType<typeof extractSemanticPlanFromItems>) => {
  const plannedBudget = toolBudgetForPlan(plan)
  const hardCap = plan?.complexity === 'high' ? 3 : 2
  return Math.max(0, Math.min(plannedBudget, hardCap))
}

const answerabilityRequestText = (plan: ReturnType<typeof extractSemanticPlanFromItems>) => [
  String(plan?.conversationState?.resolvedRequest || ''),
  String(plan?.goal || '').replace(PROVIDER_WEB_CAPABILITY_MARKER, ''),
].filter(Boolean).join('\n')

const shouldBufferForAnswerabilityGuard = (plan: ReturnType<typeof extractSemanticPlanFromItems>) => (
  Boolean(plan?.knowledgeRequired) && plan?.enterpriseGroundingRequired !== true
)

export const isTrivialConversationalTurn = (items: Array<Record<string, unknown>>) => legacyIsTrivialConversationalTurn(sanitizeItems(items))

const primaryAgentInstruction = [
  '[JETWORK PRIMARY LLM AGENT MODE]',
  'Bu turnün karar verici modeli sensin. Ayrı bir planner senin yerine knowledge/web kullanma kararı vermemiştir.',
  'Knowledge araçları kullanılabilir capabilitylerdir; yalnız gerçekten yararlıysa çağır. Genel analiz sırf analiz olduğu için kaynak araması gerektirmez.',
  'Procedural skill araçları görevin nasıl yapılacağını öğretir; kurumsal bilgi veya citation değildir. Uzman bir iş akışı gerekiyorsa uygun skill ara ve yalnız gerekli skillleri yükle.',
  'JetWork çalışma alanındaki iş/süreç terimleri kurum bağlamına işaret edebilir. Kuruma özgü ayrıntı cevabı anlamlı biçimde iyileştirecekse knowledge aracını kendin kullan.',
  'Bir tool sonucu kullanıcının sorduğu spesifik bilgiyi doğrulamıyorsa o bilgiyi tahmin etme veya tamamlamaya çalışma.',
  'Hiç güvenilir kayıt bulunmaması ile kayıt bulunup kullanıcının sorduğu alanın/iddianın kaynakta yer almamasını birbirinden ayır.',
  'Kanıt yetersizse cevabı kullanıcının gerçek sorusuna göre dinamik kur: tam olarak hangi bilgiyi doğrulayamadığını doğal dille söyle. Konu teknik değilse teknik terminoloji kullanma; kullanıcı sormadıysa class, method, tablo, kod gibi örnekler ekleme.',
  'Genel SAP veya teknik bilgi sorularında doğrulanmamış Z*, CHECK_* veya kuruma özel identifier örnekleri üretme. Genel bilgiyi bu özel kodlara bağlamadan açıklayabilirsin.',
  'Exact bir identifier kanıtta bulunmadıysa identifierı yalnız doğrulanamama bağlamında tekrar edebilirsin; onun koşulu, anlamı, metni, davranışı veya ilişkileri hakkında doğrulanmamış ayrıntı ekleme.',
  'Kaynak yetersizliği cevabın tamamını otomatik olarak yasaklamaz. Doğrulanmış kısmı ayır; genel reasoning yararlıysa bunun genel bir değerlendirme olduğunu açıkça belli ederek devam et.',
  'Aynı bilgi alanında iki anlamlı knowledge araması da sonuç vermediyse yeni knowledge araması yapma; provider-native web capabilitysi açıksa web araştırmasına geçebilirsin.',
  'Gereksiz tool çağrısı yapma. İlk tool sonucu yetersizse ancak gerçekten gerekiyorsa sorguyu iyileştirip bir kez daha dene.',
].join('\n')

const openAiPrimaryAgentDeveloperItem = (items: Array<Record<string, unknown>>) => {
  const plan = extractSemanticPlanFromItems(items)
  return {
    type: 'message',
    role: 'developer',
    content: [
      primaryAgentInstruction,
      baAnalysisInstructionForPlan(plan),
      'Bu primary-agent policy, daha önceki promptta analysis/proje/support sınıflandırmasını otomatik RAG veya kurumsal kaynak zorunluluğuna bağlayan talimatların yerine geçer.',
      'Knowledge capabilitysinin mevcut olması onu kullanmak zorunda olduğun anlamına gelmez.',
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

  // Enumeration is a knowledge-only shortcut. Skill or web capability alone
  // must never materialize a knowledge enumeration function call.
  const enumerationKnowledgeEnabled = input.tools.some(tool => ENUMERATION_KNOWLEDGE_TOOLS.has(String(tool.name || '')))
  const enumerationDispatch = input.allowTools && enumerationKnowledgeEnabled
    ? buildEnumerationFastPathDispatch(input.items)
    : null
  if (enumerationDispatch) {
    return {
      id: `jetwork-enum-fast:${crypto.randomUUID()}`,
      status: 'completed',
      model: requestedModel,
      output: [buildSyntheticEnumerationFunctionCall(enumerationDispatch)],
      usage: {
        deterministic_enumeration_dispatch: 1,
        deterministic_provider_calls_avoided: 1,
      },
    }
  }

  const providerNativeWebRequested = String(plan?.goal || '').includes(PROVIDER_WEB_CAPABILITY_MARKER)
  const emptyExactIdentifierPair = findEmptyExactIdentifierPair(input.items)
  const emptyMessageDetailLookup = hasEmptyMessageDetailLookup(input.items)
  const exactCatalogCheck = findEmptyMessageDetailNeedingCatalogCheck(input.items)
  const executedKnowledgeCalls = countExecutedKnowledgeToolCalls(input.items)
  const exactCatalogSearchAvailable = input.tools.some(tool => String(tool.name || '') === 'search_knowledge_catalog')

  if (input.allowTools && !providerNativeWebRequested && emptyExactIdentifierPair) {
    const identifier = emptyExactIdentifierPair.identifier
    const deterministicText = `${identifier} için JetWork bilgi kaynaklarında doğrulanmış bir kayıt bulamadım. Bu nedenle mesaj metni, tetikleyici koşul veya teknik ilişki uydurmuyorum.`
    input.onText(deterministicText)
    return {
      id: `jetwork-exact-id-miss:${crypto.randomUUID()}`,
      status: 'completed',
      model: requestedModel,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: deterministicText, annotations: [] }],
      }],
      usage: {
        cost_guard_exact_identifier_early_stop: 1,
        deterministic_provider_calls_avoided: 1,
        cost_guard_knowledge_tool_calls_seen: executedKnowledgeCalls,
      },
    }
  }

  if (input.allowTools && !providerNativeWebRequested && exactCatalogCheck && exactCatalogSearchAvailable) {
    return {
      id: `jetwork-exact-id-catalog:${crypto.randomUUID()}`,
      status: 'completed',
      model: requestedModel,
      output: [{
        type: 'function_call',
        call_id: `jetwork-exact-id-catalog:${crypto.randomUUID()}`,
        name: 'search_knowledge_catalog',
        arguments: JSON.stringify({
          query: exactCatalogCheck.identifier,
          objectTypes: ['message'],
          limit: 5,
        }),
      }],
      usage: {
        cost_guard_exact_identifier_catalog_dispatch: 1,
        deterministic_provider_calls_avoided: 1,
        cost_guard_knowledge_tool_calls_seen: executedKnowledgeCalls,
      },
    }
  }

  const providerWebEnabled = providerNativeWebRequested
    || (!emptyMessageDetailLookup && (input.allowProviderWeb ?? input.allowTools))
  const emptyKnowledgeSearches = countEmptyKnowledgeSearches(input.items)
  const knowledgeBudget = boundedKnowledgeToolBudget(plan)
  const knowledgeToolsAvailable = input.tools.some(tool => KNOWLEDGE_TOOL_NAMES.has(String(tool.name || '')))
  const knowledgeBudgetExhausted = Boolean(plan?.knowledgeRequired)
    && knowledgeToolsAvailable
    && executedKnowledgeCalls >= knowledgeBudget
  const forceNoToolSynthesis = input.allowTools
    && !providerNativeWebRequested
    && emptyKnowledgeSearches >= MAX_EMPTY_KNOWLEDGE_SEARCHES

  const budgetFilteredTools = knowledgeBudgetExhausted
    ? input.tools.filter(tool => !KNOWLEDGE_TOOL_NAMES.has(String(tool.name || '')))
    : [...input.tools]
  const effectiveAllowTools = input.allowTools
    && !forceNoToolSynthesis
    && (budgetFilteredTools.length > 0 || providerWebEnabled)
  const providerInstructions = composeAssistantPrompt(sanitizeProviderInstructions(input.instructions), plan)
  const geminiInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    baAnalysisInstruction,
    effectiveAllowTools ? costGuardAgentInstruction({ budget: knowledgeBudget, executed: executedKnowledgeCalls, plan }) : '',
    knowledgeBudgetExhausted
      ? 'Kurumsal knowledge araç bütçesi tamamlandı. Yeni knowledge araması yapma; mevcut kanıtlarla ilerle. Procedural skill gerekiyorsa yalnız gerçekten zorunlu olduğunda kullan.'
      : '',
    forceNoToolSynthesis
      ? 'İki ayrı knowledge araması da sonuç vermedi. Yeni araç çağırma; kullanıcının verdiği bilgiler ve mevcut kanıtlarla dürüst nihai yanıtı üret. Kaynakta doğrulanamayan kurum özelini açıkça belirt ama kullanıcının kendi verdiği gereksinimleri analiz etmeyi bırakma.'
      : '',
    !forceNoToolSynthesis && providerWebEnabled ? PROVIDER_WEB_CAPABILITY_MARKER : '',
  ].filter(Boolean).join('\n\n')

  const requireProviderWebEvidence = plan?.intent === 'research' && providerWebEnabled
  const bufferForAnswerability = shouldBufferForAnswerabilityGuard(plan) || requireProviderWebEvidence
  let firstProviderText = ''
  const firstResponse = await legacyRequestGeminiResponse({
    ...input,
    model: requestedModel,
    instructions: geminiInstructions,
    items: forceNoToolSynthesis
      ? buildNoToolRecoveryItems(input.items)
      : effectiveAllowTools
        ? compactGeminiAgentItems(sanitizeItems(input.items))
        : sanitizeItems(input.items),
    tools: effectiveAllowTools ? budgetFilteredTools : [],
    allowTools: effectiveAllowTools,
    onText: delta => {
      if (bufferForAnswerability) firstProviderText += delta
      else input.onText(delta)
    },
  })
  assertExplicitGeminiModelPreserved(requestedModel, firstResponse.model)

  const answerability = bufferForAnswerability
    ? sanitizeNovelCustomIdentifierClaims(firstProviderText, answerabilityRequestText(plan))
    : { text: firstProviderText, removedSegments: 0, removedIdentifiers: [] as string[] }
  if (
    bufferForAnswerability
    && firstProviderText
    && (!requireProviderWebEvidence || responseHasProviderWebEvidence(firstResponse))
  ) input.onText(answerability.text)

  const firstUsage = usageWithGeminiEstimatedCost(String(firstResponse.model || requestedModel), firstResponse.usage, {
    primary_llm_agent_calls: effectiveAllowTools ? 1 : 0,
    primary_llm_final_calls: effectiveAllowTools ? 0 : 1,
    cost_guard_context_compacted_calls: effectiveAllowTools ? 1 : 0,
    cost_guard_knowledge_tool_budget: knowledgeBudget,
    cost_guard_knowledge_tool_calls_seen: executedKnowledgeCalls,
    ...(knowledgeBudgetExhausted ? { cost_guard_knowledge_budget_exhausted: 1 } : {}),
    ...(emptyMessageDetailLookup && !providerNativeWebRequested ? { cost_guard_provider_web_suppressed_after_exact_miss: 1 } : {}),
    ...(forceNoToolSynthesis ? { gemini_empty_knowledge_forced_synthesis: 1 } : {}),
    ...(providerNativeWebRequested ? { gemini_native_web_requested: 1 } : {}),
    ...(answerability.text !== firstProviderText ? {
      grounding_preflight_custom_identifier_segments_removed: answerability.removedSegments,
      grounding_preflight_custom_identifiers_removed: answerability.removedIdentifiers.length,
    } : {}),
  })

  if (
    requireProviderWebEvidence
    && !responseHasFunctionCall(firstResponse)
    && !responseHasProviderWebEvidence(firstResponse)
  ) {
    const researchTarget = answerabilityRequestText(plan).slice(0, 2_000)
    const requiredWebInstructions = [
      geminiInstructions,
      '[JETWORK REQUIRED WEB RESEARCH - MANDATORY EXECUTION]',
      'Bu bir Deep Research turudur. Nihai yanıt üretmeden önce Google Search aracını gerçekten kullan. Yalnız model bilgisinden cevap verme.',
      'Google Search çalıştıysa grounding kaynaklarını ve arama sorgularını response metadata içinde koru. Arama sonucunda güvenilir kaynak yoksa bunu açıkça belirt.',
      researchTarget ? `Araştırma hedefi: ${researchTarget}` : '',
    ].filter(Boolean).join('\n\n')
    let requiredWebText = ''
    const requiredWebResponse = await legacyRequestGeminiResponse({
      ...input,
      model: requestedModel,
      instructions: requiredWebInstructions,
      items: [
        ...buildNoToolRecoveryItems(input.items),
        ...(researchTarget ? [{ role: 'user', content: `[JETWORK_DEEP_RESEARCH_TARGET]\n${researchTarget}\n[END_JETWORK_DEEP_RESEARCH_TARGET]` }] : []),
      ],
      tools: [],
      allowTools: true,
      onText: delta => { requiredWebText += delta },
    })
    assertExplicitGeminiModelPreserved(requestedModel, requiredWebResponse.model)
    const webEvidenceObserved = responseHasProviderWebEvidence(requiredWebResponse)
    const webExecutionObserved = responseHasProviderWebExecution(requiredWebResponse)
    const requiredWebAnswerability = shouldBufferForAnswerabilityGuard(plan)
      ? sanitizeNovelCustomIdentifierClaims(requiredWebText, answerabilityRequestText(plan))
      : { text: requiredWebText, removedSegments: 0, removedIdentifiers: [] as string[] }
    const requiredWebUsage = usageWithGeminiEstimatedCost(String(requiredWebResponse.model || requestedModel), requiredWebResponse.usage, {
      primary_llm_agent_calls: 1,
      gemini_native_web_required_retry: 1,
      gemini_native_web_required_executed: webExecutionObserved ? 1 : 0,
      ...(requiredWebResponse.webSources?.length ? { gemini_native_web_required_source_count: requiredWebResponse.webSources.length } : {}),
      ...(!webEvidenceObserved ? { gemini_native_web_required_miss: 1 } : {}),
      ...(webExecutionObserved && !webEvidenceObserved ? { gemini_native_web_required_no_citable_sources: 1 } : {}),
      ...(requiredWebAnswerability.text !== requiredWebText ? {
        grounding_preflight_custom_identifier_segments_removed: requiredWebAnswerability.removedSegments,
        grounding_preflight_custom_identifiers_removed: requiredWebAnswerability.removedIdentifiers.length,
      } : {}),
    })

    if (webEvidenceObserved) {
      if (requiredWebText) input.onText(requiredWebAnswerability.text)
      return {
        ...requiredWebResponse,
        usage: mergeNumericUsage(firstUsage, requiredWebUsage),
      }
    }

    const deterministicWebMiss = webExecutionObserved
      ? 'Deep Research için Google Search çalıştı ancak doğrulanabilir web kaynağı dönmedi. Web araştırmasını kaynaklı olarak tamamlanmış saymıyorum; kurumsal veya teknik ayrıntıları uydurmuyorum.'
      : 'Deep Research için Google Search çağrısını doğrulayamadım; web araştırmasını tamamlanmış saymıyorum. Kurumsal veya teknik ayrıntıları kaynak yokken uydurmuyorum.'
    input.onText(deterministicWebMiss)
    return {
      id: `jetwork-required-web-miss:${crypto.randomUUID()}`,
      status: 'completed',
      model: String(requiredWebResponse.model || requestedModel),
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: deterministicWebMiss }],
      }],
      webSources: [],
      webSearchQueries: [],
      usage: mergeNumericUsage(firstUsage, requiredWebUsage),
    }
  }

  if (responseHasFunctionCall(firstResponse) || responseHasVisibleText(firstResponse)) {
    return { ...firstResponse, usage: firstUsage }
  }

  // Gemini can occasionally finish a valid request with neither a function call
  // nor visible text. Make exactly one no-tool final attempt instead of failing
  // the turn immediately or allowing transport recovery to replay it.
  const recoveryInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    baAnalysisInstruction,
    '[JETWORK EMPTY FINAL RECOVERY]',
    'Önceki deneme kullanıcıya görünür bir yanıt üretmedi. Bu son denemede hiçbir araç çağırma. Kullanıcının mesajını ve varsa mevcut tool sonuçlarını kullanarak doğrudan, dürüst bir nihai yanıt üret. Kaynak bulunamadıysa bunu açıkça söyle; kullanıcının bizzat verdiği gereksinimleri yine de analiz et.',
  ].join('\n\n')
  let recoveryProviderText = ''
  const recoveryResponse = await legacyRequestGeminiResponse({
    ...input,
    model: requestedModel,
    instructions: recoveryInstructions,
    items: buildNoToolRecoveryItems(input.items),
    tools: [],
    allowTools: false,
    onText: delta => {
      if (bufferForAnswerability) recoveryProviderText += delta
      else input.onText(delta)
    },
  })
  assertExplicitGeminiModelPreserved(requestedModel, recoveryResponse.model)
  const recoveryAnswerability = bufferForAnswerability
    ? sanitizeNovelCustomIdentifierClaims(recoveryProviderText, answerabilityRequestText(plan))
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
  const cleaned = sanitizeItems(items).map(item => {
    const { _geminiContent: _metadata, _geminiSkipContent: _skip, ...clean } = item
    return clean
  })
  const enumerationDispatch = buildEnumerationFastPathDispatch(items)
  const withPrimaryAgentPolicy = [openAiPrimaryAgentDeveloperItem(items), ...cleaned]
  return enumerationDispatch
    ? [...withPrimaryAgentPolicy, buildOpenAiEnumerationFastPathMarkerItem(enumerationDispatch)]
    : withPrimaryAgentPolicy
}
