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
  extractSemanticPlanFromItems,
  normalizeGeminiRequestedModel,
  responseVisibleText as costGuardResponseVisibleText,
  toolBudgetForPlan,
  usageWithGeminiEstimatedCost,
} from './geminiCostGuard.ts'
import { assertExplicitGeminiModelPreserved } from './geminiProviderLock.ts'
import { compactAssistantConversationMemory } from './conversationMemory.ts'
import { composeAssistantPrompt } from './assistantPromptProfiles.ts'
import { baAnalysisInstructionForPlan } from './baAnalysisContract.ts'
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

const isLowCostDirectFinalPlan = (plan: ReturnType<typeof extractSemanticPlanFromItems>) => Boolean(
  plan
  && plan.intent === 'simple_answer'
  && plan.complexity === 'low'
  && !plan.knowledgeRequired
  && plan.webMode === 'none'
  && plan.verificationRequired !== true
)

const mergeWebSources = (
  first?: Array<{ title: string; url: string }>,
  second?: Array<{ title: string; url: string }>,
) => {
  const seen = new Set<string>()
  return [...(first || []), ...(second || [])].filter(source => {
    const key = String(source.url || '').trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const mergeWebQueries = (first?: string[], second?: string[]) => [...new Set([...(first || []), ...(second || [])])]

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
  const providerWebEnabled = providerNativeWebRequested || (input.allowProviderWeb ?? input.allowTools)
  const emptyKnowledgeSearches = countEmptyKnowledgeSearches(input.items)
  const knowledgeBudget = boundedKnowledgeToolBudget(plan)
  const executedKnowledgeCalls = countExecutedKnowledgeToolCalls(input.items)
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
  const directLiteFinal = isLowCostDirectFinalPlan(plan)
  const effectiveTools = directLiteFinal ? [] : budgetFilteredTools
  const effectiveAllowTools = !directLiteFinal
    && input.allowTools
    && !forceNoToolSynthesis
    && (effectiveTools.length > 0 || providerWebEnabled)
  const requestedModelIsLite = requestedModel === GEMINI_AGENT_MODEL || requestedModel === GEMINI_SEMANTIC_MODEL
  const useCostGuardAgentModel = !requestedModelIsLite && (effectiveAllowTools || directLiteFinal)
  const executionModel = useCostGuardAgentModel ? GEMINI_AGENT_MODEL : requestedModel

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
    !forceNoToolSynthesis && providerWebEnabled && !directLiteFinal ? PROVIDER_WEB_CAPABILITY_MARKER : '',
  ].filter(Boolean).join('\n\n')

  const firstItems = forceNoToolSynthesis
    ? buildGeminiFinalSynthesisItems(sanitizeItems(input.items))
    : useCostGuardAgentModel && effectiveAllowTools
      ? compactGeminiAgentItems(sanitizeItems(input.items))
      : sanitizeItems(input.items)

  const firstResponse = await legacyRequestGeminiResponse({
    ...input,
    model: executionModel,
    instructions: geminiInstructions,
    items: firstItems,
    tools: effectiveAllowTools ? effectiveTools : [],
    allowTools: effectiveAllowTools,
    onText: useCostGuardAgentModel ? () => {} : input.onText,
  })
  assertExplicitGeminiModelPreserved(executionModel, firstResponse.model)
  const firstUsage = usageWithGeminiEstimatedCost(String(firstResponse.model || executionModel), firstResponse.usage, {
    primary_llm_agent_calls: effectiveAllowTools ? 1 : 0,
    primary_llm_final_calls: effectiveAllowTools ? 0 : 1,
    cost_guard_agent_model_calls: useCostGuardAgentModel && effectiveAllowTools ? 1 : 0,
    cost_guard_lite_direct_final_calls: useCostGuardAgentModel && directLiteFinal ? 1 : 0,
    cost_guard_knowledge_tool_budget: knowledgeBudget,
    cost_guard_knowledge_tool_calls_seen: executedKnowledgeCalls,
    ...(knowledgeBudgetExhausted ? { cost_guard_knowledge_budget_exhausted: 1 } : {}),
    ...(forceNoToolSynthesis ? { gemini_empty_knowledge_forced_synthesis: 1 } : {}),
    ...(providerNativeWebRequested ? { gemini_native_web_requested: 1 } : {}),
  })

  if (responseHasFunctionCall(firstResponse)) {
    return { ...firstResponse, usage: firstUsage }
  }

  const agentDraft = costGuardResponseVisibleText(firstResponse)
  const strongFinalRequired = useCostGuardAgentModel
    && effectiveAllowTools
    && responseHasVisibleText(firstResponse)
    && !directLiteFinal

  if (strongFinalRequired) {
    const finalInstructions = [
      providerInstructions,
      primaryAgentInstruction,
      baAnalysisInstruction,
      '[JETWORK COST GUARD FINAL SYNTHESIS]',
      'Araştırma/araç turu düşük maliyetli agent modelinde tamamlandı. Bu son çağrıda hiçbir araç kullanma. Mevcut konuşma, tool kanıtları ve agent taslağını güçlü nihai yanıta dönüştür.',
      'Agent taslağında gerçek web kaynakları bulunuyorsa yalnız o URLleri koru; yeni URL veya kaynak uydurma.',
    ].filter(Boolean).join('\n\n')
    const finalResponse = await legacyRequestGeminiResponse({
      ...input,
      model: requestedModel,
      instructions: finalInstructions,
      items: buildGeminiFinalSynthesisItems(sanitizeItems(input.items), agentDraft),
      tools: [],
      allowTools: false,
      onText: input.onText,
    })
    assertExplicitGeminiModelPreserved(requestedModel, finalResponse.model)
    const finalUsage = usageWithGeminiEstimatedCost(String(finalResponse.model || requestedModel), finalResponse.usage, {
      primary_llm_agent_calls: 0,
      primary_llm_final_calls: 1,
      cost_guard_final_synthesis_calls: 1,
      cost_guard_agent_draft_synthesized: 1,
    })
    return {
      ...finalResponse,
      webSources: mergeWebSources(firstResponse.webSources, finalResponse.webSources),
      webSearchQueries: mergeWebQueries(firstResponse.webSearchQueries, finalResponse.webSearchQueries),
      usage: mergeNumericUsage(firstUsage, finalUsage),
    }
  }

  if (responseHasVisibleText(firstResponse)) {
    if (useCostGuardAgentModel && agentDraft) input.onText(agentDraft)
    return { ...firstResponse, usage: firstUsage }
  }

  // Gemini can occasionally finish a valid request with neither a function call
  // nor visible text. Make exactly one no-tool final attempt instead of failing
  // the turn immediately or allowing transport recovery to replay it.
  const recoveryModel = directLiteFinal ? executionModel : requestedModel
  const recoveryInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    baAnalysisInstruction,
    '[JETWORK EMPTY FINAL RECOVERY]',
    'Önceki deneme kullanıcıya görünür bir yanıt üretmedi. Bu son denemede hiçbir araç çağırma. Kullanıcının mesajını ve varsa mevcut tool sonuçlarını kullanarak doğrudan, dürüst bir nihai yanıt üret. Kaynak bulunamadıysa bunu açıkça söyle; kullanıcının bizzat verdiği gereksinimleri yine de analiz et.',
  ].join('\n\n')
  const recoveryResponse = await legacyRequestGeminiResponse({
    ...input,
    model: recoveryModel,
    instructions: recoveryInstructions,
    items: buildGeminiFinalSynthesisItems(sanitizeItems(input.items)),
    tools: [],
    allowTools: false,
    onText: input.onText,
  })
  assertExplicitGeminiModelPreserved(recoveryModel, recoveryResponse.model)
  const recoveryUsage = usageWithGeminiEstimatedCost(String(recoveryResponse.model || recoveryModel), recoveryResponse.usage, {
    primary_llm_agent_calls: 0,
    primary_llm_final_calls: 1,
    gemini_empty_final_retry: 1,
    ...(recoveryModel === GEMINI_AGENT_MODEL ? { cost_guard_lite_recovery_final_calls: 1 } : {}),
  })
  return {
    ...recoveryResponse,
    webSources: mergeWebSources(firstResponse.webSources, recoveryResponse.webSources),
    webSearchQueries: mergeWebQueries(firstResponse.webSearchQueries, recoveryResponse.webSearchQueries),
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