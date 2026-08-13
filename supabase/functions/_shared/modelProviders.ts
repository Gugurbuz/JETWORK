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
  'Gereksiz tool çağrısı yapma. İlk tool sonucu yetersizse ancak gerçekten gerekiyorsa sorguyu iyileştirip tekrar dene.',
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
  allowProviderWeb?: boolean
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

  const providerInstructions = composeAssistantPrompt(sanitizeProviderInstructions(input.instructions), plan)
  const providerWebEnabled = input.allowProviderWeb ?? input.allowTools
  const geminiInstructions = [
    providerInstructions,
    primaryAgentInstruction,
    providerWebEnabled ? PROVIDER_WEB_CAPABILITY_MARKER : '',
  ].filter(Boolean).join('\n\n')
  const response = await legacyRequestGeminiResponse({
    ...input,
    model: requestedModel,
    instructions: geminiInstructions,
    items: sanitizeItems(input.items),
  })
  return {
    ...response,
    usage: usageWithGeminiEstimatedCost(String(response.model || requestedModel), response.usage, {
      primary_llm_agent_calls: input.allowTools ? 1 : 0,
      primary_llm_final_calls: input.allowTools ? 0 : 1,
    }),
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
