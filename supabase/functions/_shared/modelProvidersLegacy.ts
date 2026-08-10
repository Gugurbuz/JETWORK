import { GoogleGenAI } from 'npm:@google/genai@1.52.0'

export const OPENAI_MODELS = new Set(['gpt-5.6-sol', 'gpt-5.6'])
export const GEMINI_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.5-flash',
])

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'
export const GEMINI_SUBSTANTIVE_MODEL = 'gemini-3.1-pro-preview'
const GEMINI_FLASH_LITE_MODEL = 'gemini-3.1-flash-lite-preview'
const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
const GEMINI_RETRY_DELAYS_MS = [350] as const
const GEMINI_PRO_ATTEMPT_TIMEOUT_MS = 10_000
const GEMINI_TOOL_ATTEMPT_TIMEOUT_MS = 18_000
const GEMINI_FINAL_SYNTHESIS_TIMEOUT_MS = 45_000
const GEMINI_PRO_CIRCUIT_BREAKER_MS = 60_000
let geminiProUnavailableUntil = 0

export type AssistantProvider = 'openai' | 'gemini'

export interface NormalizedModelResponse {
  id?: string
  status?: string
  model?: string
  output?: Array<Record<string, unknown>>
  usage?: Record<string, number>
  error?: { message?: string }
  incomplete_details?: { reason?: string }
}

export const providerForModel = (model: string): AssistantProvider => (
  GEMINI_MODELS.has(model) ? 'gemini' : 'openai'
)

const textFromContent = (content: unknown) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const candidate = part as Record<string, unknown>
      return typeof candidate.text === 'string' ? candidate.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

const normalizeConversationText = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const TRIVIAL_CONVERSATION_PATTERN = /^(?:selam(?:lar)?|merhaba|hey|hi|hello|gunaydin|iyi aksamlar|iyi geceler|nasilsin|naber|tesekkur(?:ler)?|tesekkur ederim|sag ol|sagol|eyvallah|tamam|ok|okay)$/i

const lastUserText = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (String(item.role || '') !== 'user') continue
    return textFromContent(item.content)
  }
  return ''
}

export const isTrivialConversationalTurn = (items: Array<Record<string, unknown>>) => (
  TRIVIAL_CONVERSATION_PATTERN.test(normalizeConversationText(lastUserText(items)))
)

const compactConversationalItems = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (String(item.role || '') !== 'user') continue
    const text = textFromContent(item.content)
    return text ? [{ role: 'user', content: text }] : items
  }
  return items
}

const compactNoToolSynthesisItems = (items: Array<Record<string, unknown>>) => items.flatMap(item => {
  const type = String(item.type || '')
  const role = String(item.role || '')
  if (type === 'function_call' || type === 'function_call_output') return []
  const text = textFromContent(item.content)
  if (!text) return []
  if (!type && (role === 'user' || role === 'assistant')) return [{ role, content: text }]
  if (type === 'message') return [{ role: role === 'user' ? 'user' : 'assistant', content: text }]
  return []
})

const compactToolRecoveryItems = (items: Array<Record<string, unknown>>) => {
  const callNames = new Map<string, string>()
  const toolEvidence: string[] = []
  for (const item of items) {
    const type = String(item.type || '')
    if (type === 'function_call') {
      callNames.set(String(item.call_id || ''), String(item.name || 'knowledge_tool'))
      continue
    }
    if (type !== 'function_call_output') continue
    const callId = String(item.call_id || '')
    const toolName = callNames.get(callId) || 'knowledge_tool'
    const output = typeof item.output === 'string'
      ? item.output
      : JSON.stringify(item.output ?? '')
    if (output.trim()) toolEvidence.push(`[${toolName}]\n${output.trim()}`)
  }
  const conversational = compactNoToolSynthesisItems(items)
  if (!toolEvidence.length) return conversational
  return [
    ...conversational,
    {
      role: 'user',
      content: `[JETWORK_TOOL_EVIDENCE]\n${toolEvidence.join('\n\n').slice(0, 14_000)}\n[END_JETWORK_TOOL_EVIDENCE]`,
    },
  ]
}

const TRIVIAL_CONVERSATION_INSTRUCTIONS = [
  'Sen JetWork AI asistanısın.',
  'Kullanıcının gündelik selamlaşma, teşekkür veya kısa nezaket mesajına aynı dilde doğal ve çok kısa yanıt ver.',
  'Kullanıcı istemedikçe Enerjisa, SAP, süreç, teknik talep, yetenek listesi veya soru menüsü ekleme.',
  'Yanıtı en fazla iki kısa cümle tut.',
].join('\n')

const GEMINI_EVIDENCE_INSTRUCTIONS = [
  '[JETWORK KANIT BÜTÜNLÜĞÜ - ZORUNLU]',
  'SAP/CRM hata kodu, mesaj kodu, class, method, function, tablo, alan, ürün veya iş kuralı gibi kurumsal teknik ayrıntıları yalnız konuşmada veya JetWork tarafından sağlanan kanıtta açıkça yer alıyorsa kesin gerçek olarak yaz.',
  'Kullanıcı belirli bir teknik kimlik soruyorsa (ör. ZCRM2-545), yakın kodlar veya benzer SAP süreçleri o kimlik için kanıt değildir.',
  'İstenen teknik kimlik kanıtta birebir bulunmuyorsa bunu açıkça söyle; genel SAP bilgisinden class, method, mesaj metni, tetikleyici veya çözüm uydurma.',
  'Kanıt ile çıkarımı ayır. Kanıtsız teknik çıkarımı kesinlik diliyle sunma.',
].join('\n')

const parseToolOutput = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

const toGeminiContents = (items: Array<Record<string, unknown>>) => {
  const contents: Array<Record<string, unknown>> = []
  const callNames = new Map<string, string>()
  for (const item of items) {
    const type = String(item.type || '')
    const role = String(item.role || '')
    const geminiContent = item._geminiContent
    if (type === 'function_call') callNames.set(String(item.call_id || ''), String(item.name || ''))
    if (item._geminiSkipContent === true) continue
    if (geminiContent && typeof geminiContent === 'object') {
      contents.push(geminiContent as Record<string, unknown>)
      continue
    }
    if ((role === 'user' || role === 'assistant') && !type) {
      const text = textFromContent(item.content)
      if (text) contents.push({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text }] })
      continue
    }
    if (type === 'message') {
      const text = textFromContent(item.content)
      if (text) contents.push({ role: role === 'user' ? 'user' : 'model', parts: [{ text }] })
      continue
    }
    if (type === 'function_call') {
      const callId = String(item.call_id || crypto.randomUUID())
      const name = String(item.name || '')
      callNames.set(callId, name)
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(String(item.arguments || '{}')) } catch { args = {} }
      contents.push({ role: 'model', parts: [{ functionCall: { id: callId, name, args } }] })
      continue
    }
    if (type === 'function_call_output') {
      const callId = String(item.call_id || '')
      const name = callNames.get(callId) || 'knowledge_tool'
      contents.push({ role: 'user', parts: [{ functionResponse: { id: callId, name, response: { output: parseToolOutput(item.output) } } }] })
    }
  }
  return contents
}

const groundingSources = (candidate: any): Array<{ title: string; url: string }> => {
  const chunks = Array.isArray(candidate?.groundingMetadata?.groundingChunks) ? candidate.groundingMetadata.groundingChunks : []
  const seen = new Set<string>()
  const sources: Array<{ title: string; url: string }> = []
  for (const chunk of chunks) {
    const web = chunk?.web
    const url = typeof web?.uri === 'string' ? web.uri.trim() : ''
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    sources.push({ title: typeof web?.title === 'string' && web.title.trim() ? web.title.trim() : 'Web kaynağı', url })
  }
  return sources.slice(0, 8)
}

const appendGroundingSources = (text: string, candidate: any) => {
  if (!text.trim()) return text
  const sources = groundingSources(candidate)
  if (!sources.length) return text
  return `${text.trim()}\n\nKaynaklar:\n${sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join('\n')}`
}

const geminiErrorText = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>
    return String(candidate.message || candidate.status || candidate.code || '')
  }
  return String(error || '')
}

const isRetryableGeminiError = (error: unknown) => {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const numericCode = Number(candidate.code || candidate.statusCode || candidate.status)
  if ([408, 429, 500, 502, 503, 504].includes(numericCode)) return true
  return /408|429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|AbortError|signal has been aborted|high demand|temporar|timeout|timed out|network/i.test(geminiErrorText(error))
}

const delayWithAbort = async (milliseconds: number, signal?: AbortSignal) => {
  if (milliseconds <= 0) return
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => finish(signal?.reason || new DOMException('Aborted', 'AbortError'))
    const timeout = setTimeout(() => finish(), milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const generateGeminiAttempt = async (input: {
  ai: GoogleGenAI
  model: string
  contents: Array<Record<string, unknown>>
  config: Record<string, unknown>
  timeoutMs: number
  parentSignal?: AbortSignal
}) => {
  const controller = new AbortController()
  const onParentAbort = () => controller.abort(input.parentSignal?.reason)
  if (input.parentSignal?.aborted) controller.abort(input.parentSignal.reason)
  else input.parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('Gemini provider attempt timed out.', 'TimeoutError')), input.timeoutMs)
  try {
    return await input.ai.models.generateContent({ model: input.model, contents: input.contents, config: { ...input.config, abortSignal: controller.signal } } as any)
  } finally {
    clearTimeout(timeout)
    input.parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

async function generateGeminiContentWithResilience(input: {
  ai: GoogleGenAI
  model: string
  contents: Array<Record<string, unknown>>
  config: Record<string, unknown>
  allowSameProviderModelFallback: boolean
  finalSynthesis: boolean
  artifactSynthesis: boolean
  signal?: AbortSignal
}) {
  const canFailOverFromPro = input.allowSameProviderModelFallback && input.model === GEMINI_SUBSTANTIVE_MODEL
  const proCircuitOpen = canFailOverFromPro && Date.now() < geminiProUnavailableUntil
  const models = proCircuitOpen ? [DEFAULT_GEMINI_MODEL] : [input.model, ...(canFailOverFromPro ? [DEFAULT_GEMINI_MODEL] : [])]
  let lastError: unknown
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex]
    const immediateFailoverCandidate = model === GEMINI_SUBSTANTIVE_MODEL && modelIndex < models.length - 1
    const maxAttempts = immediateFailoverCandidate || input.artifactSynthesis ? 1 : GEMINI_RETRY_DELAYS_MS.length + 1
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await generateGeminiAttempt({
          ai: input.ai,
          model,
          contents: input.contents,
          config: input.config,
          timeoutMs: model === GEMINI_SUBSTANTIVE_MODEL
            ? GEMINI_PRO_ATTEMPT_TIMEOUT_MS
            : input.finalSynthesis || input.artifactSynthesis
              ? GEMINI_FINAL_SYNTHESIS_TIMEOUT_MS
              : GEMINI_TOOL_ATTEMPT_TIMEOUT_MS,
          parentSignal: input.signal,
        })
        if (model === GEMINI_SUBSTANTIVE_MODEL) geminiProUnavailableUntil = 0
        return { response, model }
      } catch (error) {
        lastError = error
        if (input.signal?.aborted) throw error
        if (!isRetryableGeminiError(error)) throw error
        if (immediateFailoverCandidate) {
          geminiProUnavailableUntil = Date.now() + GEMINI_PRO_CIRCUIT_BREAKER_MS
          console.warn('Gemini Pro failed transiently; switching immediately to same-provider stable Flash fallback', {
            fromModel: model, toModel: models[modelIndex + 1], error: geminiErrorText(error).slice(0, 500),
          })
          break
        }
        if (attempt < maxAttempts - 1) {
          const delayMs = GEMINI_RETRY_DELAYS_MS[Math.min(attempt, GEMINI_RETRY_DELAYS_MS.length - 1)]
          console.warn('Gemini request failed transiently; retrying once with bounded backoff', {
            model, attempt: attempt + 1, delayMs, error: geminiErrorText(error).slice(0, 500),
          })
          await delayWithAbort(delayMs, input.signal)
        }
      }
    }
  }
  throw lastError || new Error('Gemini request failed without an error payload.')
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
  const ai = new GoogleGenAI({ apiKey: input.apiKey })
  const trivialConversation = !input.allowTools && isTrivialConversationalTurn(input.items)
  const effectiveItems = trivialConversation ? compactConversationalItems(input.items) : input.allowTools ? input.items : compactNoToolSynthesisItems(input.items)
  const executionModel = !trivialConversation && input.model === GEMINI_FLASH_LITE_MODEL ? GEMINI_SUBSTANTIVE_MODEL : input.model
  const providerWebEnabled = !trivialConversation && input.allowTools && input.instructions.includes(PROVIDER_WEB_CAPABILITY_MARKER)
  const artifactSynthesis = !trivialConversation && (input.instructions.includes('Intent: document') || input.instructions.includes('[JETWORK PROMPT PROFILE: artifact]'))
  const finalSynthesis = !input.allowTools && !trivialConversation
  const config: Record<string, unknown> = {
    systemInstruction: trivialConversation ? TRIVIAL_CONVERSATION_INSTRUCTIONS : [input.instructions, GEMINI_EVIDENCE_INSTRUCTIONS].filter(Boolean).join('\n\n'),
    maxOutputTokens: trivialConversation ? Math.min(input.maxOutputTokens, 160) : input.maxOutputTokens,
  }
  if (artifactSynthesis) {
    // Artifact generation needs some planning headroom, but the former default
    // thinking level consumed thousands of reasoning tokens for templated output.
    config.thinkingConfig = { thinkingLevel: 'low' }
  } else if (finalSynthesis && executionModel === DEFAULT_GEMINI_MODEL) {
    // Grounded answer synthesis should spend tokens on evidence/output rather than
    // hidden reasoning after tools have already resolved the task.
    config.thinkingConfig = { thinkingLevel: 'minimal' }
  }
  if (input.allowTools) {
    const declarations = input.tools.map(tool => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters }))
    config.tools = [...(providerWebEnabled ? [{ googleSearch: {} }] : []), ...(declarations.length ? [{ functionDeclarations: declarations }] : [])]
    config.toolConfig = {
      ...(providerWebEnabled ? { includeServerSideToolInvocations: true } : {}),
      functionCallingConfig: { mode: providerWebEnabled ? 'VALIDATED' : 'AUTO' },
    }
  }

  let generated: { response: any; model: string }
  try {
    generated = await generateGeminiContentWithResilience({
      ai,
      model: executionModel,
      contents: toGeminiContents(effectiveItems),
      config,
      allowSameProviderModelFallback: !trivialConversation,
      finalSynthesis,
      artifactSynthesis,
      signal: input.signal,
    })
  } catch (error) {
    if (!input.allowTools || trivialConversation || input.signal?.aborted || !isRetryableGeminiError(error)) throw error
    console.warn('Gemini tool loop exhausted transient retries; forcing one bounded no-tool recovery synthesis', {
      fromModel: executionModel,
      toModel: DEFAULT_GEMINI_MODEL,
      error: geminiErrorText(error).slice(0, 500),
    })
    const recoveryConfig: Record<string, unknown> = {
      ...config,
      systemInstruction: [
        String(config.systemInstruction || ''),
        '[JETWORK TOOL RECOVERY]',
        'Araç çağrısı geçici sağlayıcı sorunu nedeniyle devam edemedi. Aşağıdaki JETWORK_TOOL_EVIDENCE bloklarını kanıt olarak kullan ve yeni araç çağrısı yapmadan dürüst nihai yanıtı üret. Kanıt yetersizse bunu açıkça belirt.',
      ].filter(Boolean).join('\n\n'),
    }
    delete recoveryConfig.tools
    delete recoveryConfig.toolConfig
    const recoveryResponse = await generateGeminiAttempt({
      ai,
      model: DEFAULT_GEMINI_MODEL,
      contents: toGeminiContents(compactToolRecoveryItems(input.items)),
      config: recoveryConfig,
      timeoutMs: GEMINI_FINAL_SYNTHESIS_TIMEOUT_MS,
      parentSignal: input.signal,
    })
    generated = { response: recoveryResponse, model: DEFAULT_GEMINI_MODEL }
  }

  const response = generated.response
  const actualModel = generated.model
  const candidate = (response as any)?.candidates?.[0]
  const candidateContent = candidate?.content
  const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : []
  const rawVisibleText = parts.filter((part: any) => !part?.thought && typeof part?.text === 'string').map((part: any) => part.text).join('')
  const visibleText = providerWebEnabled ? appendGroundingSources(rawVisibleText, candidate) : rawVisibleText
  if (visibleText) input.onText(visibleText)
  const functionCalls = parts.filter((part: any) => part?.functionCall)
  const output = functionCalls.length
    ? functionCalls.map((part: any, index: number) => {
        const call = part.functionCall || {}
        return { type: 'function_call', call_id: String(call.id || crypto.randomUUID()), name: String(call.name || ''), arguments: JSON.stringify(call.args || {}), _geminiContent: index === 0 ? candidateContent : undefined, _geminiSkipContent: index > 0 }
      })
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: visibleText, annotations: [] }], _geminiContent: candidateContent }]
  const metadata = (response as any)?.usageMetadata || {}
  return {
    id: String((response as any)?.responseId || crypto.randomUUID()), status: 'completed', model: actualModel, output,
    usage: { input_tokens: Number(metadata.promptTokenCount || 0), output_tokens: Number(metadata.candidatesTokenCount || 0), reasoning_tokens: Number(metadata.thoughtsTokenCount || 0), total_tokens: Number(metadata.totalTokenCount || 0) },
  }
}

export const cleanProviderItemsForOpenAi = (items: Array<Record<string, unknown>>) => items.map(item => {
  const { _geminiContent: _metadata, _geminiSkipContent: _skip, ...clean } = item
  return clean
})