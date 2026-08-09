import { GoogleGenAI } from 'npm:@google/genai@1.52.0'

export const OPENAI_MODELS = new Set(['gpt-5.6-sol', 'gpt-5.6'])
export const GEMINI_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
])

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
export const GEMINI_SUBSTANTIVE_MODEL = 'gemini-3.1-pro-preview'
const GEMINI_FLASH_LITE_MODEL = 'gemini-3.1-flash-lite-preview'
const PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'
const GEMINI_ATTEMPT_TIMEOUT_MS = 45_000
const GEMINI_RETRY_DELAYS_MS = [450, 1_200]

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

    if (type === 'function_call') {
      callNames.set(String(item.call_id || ''), String(item.name || ''))
    }
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
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            id: callId,
            name,
            response: { output: parseToolOutput(item.output) },
          },
        }],
      })
    }
  }
  return contents
}

const groundingSources = (candidate: any): Array<{ title: string; url: string }> => {
  const chunks = Array.isArray(candidate?.groundingMetadata?.groundingChunks)
    ? candidate.groundingMetadata.groundingChunks
    : []
  const seen = new Set<string>()
  const sources: Array<{ title: string; url: string }> = []
  for (const chunk of chunks) {
    const web = chunk?.web
    const url = typeof web?.uri === 'string' ? web.uri.trim() : ''
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    sources.push({
      title: typeof web?.title === 'string' && web.title.trim() ? web.title.trim() : 'Web kaynağı',
      url,
    })
  }
  return sources.slice(0, 8)
}

const appendGroundingSources = (text: string, candidate: any) => {
  if (!text.trim()) return text
  const sources = groundingSources(candidate)
  if (!sources.length) return text
  return `${text.trim()}\n\nKaynaklar:\n${sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join('\n')}`
}

const providerErrorText = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error || '')
}

const isTransientGeminiError = (error: unknown) => {
  const value = providerErrorText(error).toLocaleLowerCase('en-US')
  return /\b(408|429|500|502|503|504)\b|resource_exhausted|unavailable|deadline_exceeded|high demand|temporar|timeout|timed out|network/i.test(value)
}

const delayWithSignal = async (ms: number, signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const generateGeminiWithTimeout = async (input: {
  ai: GoogleGenAI
  model: string
  contents: Array<Record<string, unknown>>
  config: Record<string, unknown>
  parentSignal?: AbortSignal
}) => {
  const controller = new AbortController()
  const onParentAbort = () => controller.abort(input.parentSignal?.reason)
  if (input.parentSignal?.aborted) controller.abort(input.parentSignal.reason)
  else input.parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Gemini provider attempt timed out.', 'TimeoutError')), GEMINI_ATTEMPT_TIMEOUT_MS)
  try {
    return await input.ai.models.generateContent({
      model: input.model,
      contents: input.contents,
      config: { ...input.config, abortSignal: controller.signal },
    } as any)
  } finally {
    clearTimeout(timer)
    input.parentSignal?.removeEventListener('abort', onParentAbort)
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
  const ai = new GoogleGenAI({ apiKey: input.apiKey })
  const trivialConversation = !input.allowTools && isTrivialConversationalTurn(input.items)
  const effectiveItems = trivialConversation ? compactConversationalItems(input.items) : input.items
  const requestedExecutionModel = !trivialConversation && input.model === GEMINI_FLASH_LITE_MODEL
    ? GEMINI_SUBSTANTIVE_MODEL
    : input.model
  const providerWebEnabled = !trivialConversation
    && input.allowTools
    && input.instructions.includes(PROVIDER_WEB_CAPABILITY_MARKER)
  const baseConfig: Record<string, unknown> = {
    systemInstruction: trivialConversation
      ? TRIVIAL_CONVERSATION_INSTRUCTIONS
      : [input.instructions, GEMINI_EVIDENCE_INSTRUCTIONS].filter(Boolean).join('\n\n'),
    maxOutputTokens: trivialConversation ? Math.min(input.maxOutputTokens, 160) : input.maxOutputTokens,
  }

  if (input.allowTools) {
    const declarations = input.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.parameters,
    }))
    baseConfig.tools = [
      ...(providerWebEnabled ? [{ googleSearch: {} }] : []),
      ...(declarations.length ? [{ functionDeclarations: declarations }] : []),
    ]
    baseConfig.toolConfig = {
      ...(providerWebEnabled ? { includeServerSideToolInvocations: true } : {}),
      functionCallingConfig: { mode: providerWebEnabled ? 'VALIDATED' : 'AUTO' },
    }
  }

  const modelCandidates = trivialConversation
    ? [requestedExecutionModel]
    : [...new Set([
        requestedExecutionModel,
        ...(requestedExecutionModel === GEMINI_SUBSTANTIVE_MODEL ? [DEFAULT_GEMINI_MODEL] : []),
      ])]
  let response: any
  let executionModel = requestedExecutionModel
  let lastError: unknown

  outer: for (const candidateModel of modelCandidates) {
    for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        response = await generateGeminiWithTimeout({
          ai,
          model: candidateModel,
          contents: toGeminiContents(effectiveItems),
          config: baseConfig,
          parentSignal: input.signal,
        })
        executionModel = candidateModel
        break outer
      } catch (error) {
        lastError = error
        if (input.signal?.aborted || !isTransientGeminiError(error)) throw error
        if (attempt < GEMINI_RETRY_DELAYS_MS.length) {
          const jitter = Math.floor(Math.random() * 180)
          await delayWithSignal(GEMINI_RETRY_DELAYS_MS[attempt] + jitter, input.signal)
        }
      }
    }
  }
  if (!response) throw lastError || new Error('Gemini provider failed without a response.')

  const candidate = response?.candidates?.[0]
  const candidateContent = candidate?.content
  const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : []
  const rawVisibleText = parts
    .filter((part: any) => !part?.thought && typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('')
  const visibleText = providerWebEnabled ? appendGroundingSources(rawVisibleText, candidate) : rawVisibleText
  if (visibleText) input.onText(visibleText)

  const functionCalls = parts.filter((part: any) => part?.functionCall)
  const output = functionCalls.length
    ? functionCalls.map((part: any, index: number) => {
        const call = part.functionCall || {}
        return {
          type: 'function_call',
          call_id: String(call.id || crypto.randomUUID()),
          name: String(call.name || ''),
          arguments: JSON.stringify(call.args || {}),
          _geminiContent: index === 0 ? candidateContent : undefined,
          _geminiSkipContent: index > 0,
        }
      })
    : [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: visibleText, annotations: [] }],
        _geminiContent: candidateContent,
      }]

  const metadata = response?.usageMetadata || {}
  return {
    id: String(response?.responseId || crypto.randomUUID()),
    status: 'completed',
    model: executionModel,
    output,
    usage: {
      input_tokens: Number(metadata.promptTokenCount || 0),
      output_tokens: Number(metadata.candidatesTokenCount || 0),
      reasoning_tokens: Number(metadata.thoughtsTokenCount || 0),
      total_tokens: Number(metadata.totalTokenCount || 0),
    },
  }
}

export const cleanProviderItemsForOpenAi = (
  items: Array<Record<string, unknown>>,
) => items.map(item => {
  const { _geminiContent: _metadata, _geminiSkipContent: _skip, ...clean } = item
  return clean
})
