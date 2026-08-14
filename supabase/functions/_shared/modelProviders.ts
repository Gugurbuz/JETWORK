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
  extractSemanticPlanFromItems,
  normalizeGeminiRequestedModel,
  usageWithGeminiEstimatedCost,
} from './geminiCostGuard.ts'
import { compactAssistantConversationMemory } from './conversationMemory.ts'
import { composeAssistantPrompt } from './assistantPromptProfiles.ts'
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

export const isTrivialConversationalTurn = (items: Array<Record<string, unknown>>) => legacyIsTrivialConversationalTurn(sanitizeItems(items))

const primaryAgentInstruction = [
  '[JETWORK PRIMARY LLM AGENT MODE]',
  'Bu turnün karar verici modeli sensin. Ayrı bir planner senin yerine knowledge/web kullanma kararı vermemiştir.',
  'Knowledge araçları kullanılabilir capabilitylerdir; yalnız gerçekten yararlıysa çağır. Genel analiz sırf analiz olduğu için kaynak araması gerektirmez.',
  'JetWork çalışma alanındaki iş/süreç terimleri kurum bağlamına işaret edebilir. Kuruma özgü ayrıntı cevabı anlamlı biçimde iyileştirecekse knowledge aracını kendin kullan.',
  'Bir tool sonucu kullanıcının sorduğu spesifik bilgiyi doğrulamıyorsa o bilgiyi tahmin etme veya tamamlamaya çalışma.',
  'Hiç güvenilir kayıt bulunmaması ile kayıt bulunup kullanıcının sorduğu alanın/iddianın kaynakta yer almamasını birbirinden ayır.',
  'Kanıt yetersizse cevabı kullanıcının gerçek sorusuna göre dinamik kur: tam olarak hangi bilgiyi doğrulayamadığını doğal dille söyle. Konu teknik değilse teknik terminoloji kullanma; kullanıcı sormadıysa class, method, tablo, kod gibi örnekler ekleme.',
  'Exact bir identifier kanıtta bulunmadıysa identifierı yalnız doğrulanamama bağlamında tekrar edebilirsin; onun koşulu, anlamı, metni, davranışı veya ilişkileri hakkında doğrulanmamış ayrıntı ekleme.',
  'Kaynak yetersizliği cevabın tamamını otomatik olarak yasaklamaz. Doğrulanmış kısmı ayır; genel reasoning yararlıysa bunun genel bir değerlendirme olduğunu açıkça belli ederek devam et.',
  'Aynı bilgi alanında iki anlamlı knowledge araması da sonuç vermediyse yeni arama yapma; kullanıcının verdiği bilgiler ve mevcut kanıtlarla dürüst yanıtı üret.',
  'Gereksiz tool çağrısı yapma. İlk tool sonucu yetersizse ancak gerçekten gerekiyorsa sorguyu iyileştirip bir kez daha dene.',
].join('\n')

const openAiPrimaryAgentDeveloperItem = {
  type: 'message',
  role: 'developer',
  content: [
    primaryAgentInstruction,
    'Bu primary-agent policy, daha önceki promptta analysis/proje/support sınıflandırmasını otomatik RAG veya kurumsal kaynak zorunluluğuna bağlayan talimatların yerine geçer.',
    'Knowledge capabilitysinin mevcut olması onu kullanmak zorunda olduğun anlamına gelmez.',
  ].join('\n'),
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

  // Keep only the authoritative deterministic inventory shortcut. All ordinary
  // knowledge decisions are made by the requested primary model itself.
  const enumerationDispatch = input.allowTools ? buildEnumerationFastPathDispatch(input.items) : null
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

  const emptyKnowledgeSearches = countEmptyKnowledgeSearches(input.items)
  const forceNoToolSynthesis = input.allowTools && emptyKnowledgeSearches >= MAX_EMPTY_KNOWLEDGE_SEARCHES
  const effectiveAllowTools = input.allowTools && !forceNoToolSynthesis
  const providerInstructions = composeAssistantPrompt(sanitizeProviderInstructions(input.instructions), plan)
  const geminiInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    forceNoToolSynthesis
      ? 'İki ayrı knowledge araması da sonuç vermedi. Yeni araç çağırma; kullanıcının verdiği bilgiler ve mevcut kanıtlarla dürüst nihai yanıtı üret. Kaynakta doğrulanamayan kurum özelini açıkça belirt ama kullanıcının kendi verdiği gereksinimleri analiz etmeyi bırakma.'
      : '',
    effectiveAllowTools ? PROVIDER_WEB_CAPABILITY_MARKER : '',
  ].filter(Boolean).join('\n\n')
  const firstResponse = await legacyRequestGeminiResponse({
    ...input,
    model: requestedModel,
    instructions: geminiInstructions,
    items: forceNoToolSynthesis ? buildNoToolRecoveryItems(input.items) : sanitizeItems(input.items),
    tools: effectiveAllowTools ? input.tools : [],
    allowTools: effectiveAllowTools,
  })
  const firstUsage = usageWithGeminiEstimatedCost(String(firstResponse.model || requestedModel), firstResponse.usage, {
    primary_llm_agent_calls: effectiveAllowTools ? 1 : 0,
    primary_llm_final_calls: effectiveAllowTools ? 0 : 1,
    ...(forceNoToolSynthesis ? { gemini_empty_knowledge_forced_synthesis: 1 } : {}),
  })

  if (responseHasFunctionCall(firstResponse) || responseHasVisibleText(firstResponse)) {
    return { ...firstResponse, usage: firstUsage }
  }

  // Gemini can occasionally finish a valid request with neither a function call
  // nor visible text. Make exactly one no-tool final attempt instead of failing
  // the turn immediately or allowing transport recovery to replay it.
  const recoveryInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    '[JETWORK EMPTY FINAL RECOVERY]',
    'Önceki deneme kullanıcıya görünür bir yanıt üretmedi. Bu son denemede hiçbir araç çağırma. Kullanıcının mesajını ve varsa mevcut tool sonuçlarını kullanarak doğrudan, dürüst bir nihai yanıt üret. Kaynak bulunamadıysa bunu açıkça söyle; kullanıcının bizzat verdiği gereksinimleri yine de analiz et.',
  ].join('\n\n')
  const recoveryResponse = await legacyRequestGeminiResponse({
    ...input,
    model: requestedModel,
    instructions: recoveryInstructions,
    items: buildNoToolRecoveryItems(input.items),
    tools: [],
    allowTools: false,
  })
  const recoveryUsage = usageWithGeminiEstimatedCost(String(recoveryResponse.model || requestedModel), recoveryResponse.usage, {
    primary_llm_agent_calls: 0,
    primary_llm_final_calls: 1,
    gemini_empty_final_retry: 1,
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
  const withPrimaryAgentPolicy = [openAiPrimaryAgentDeveloperItem, ...cleaned]
  return enumerationDispatch
    ? [...withPrimaryAgentPolicy, buildOpenAiEnumerationFastPathMarkerItem(enumerationDispatch)]
    : withPrimaryAgentPolicy
}