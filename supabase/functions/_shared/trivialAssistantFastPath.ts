const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export const TRIVIAL_FAST_PATH_ENGINE_VERSION = 'trivial-fast-path-v3-auto-safe'
export const TRIVIAL_GEMINI_LATENCY_MODEL = 'gemini-3.1-flash-lite'
const DEPRECATED_GEMINI_FLASH_LITE_PREVIEW = 'gemini-3.1-flash-lite-preview'

const OPENAI_FAST_PATH_MODELS = new Set(['gpt-5.6-sol', 'gpt-5.6'])
const GEMINI_FAST_PATH_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  TRIVIAL_GEMINI_LATENCY_MODEL,
  DEPRECATED_GEMINI_FLASH_LITE_PREVIEW,
])

export type TrivialFastPathProvider = 'openai' | 'gemini'

const TRIVIAL_FAST_PATH_INSTRUCTIONS = [
  'Sen JetWork AI asistanısın.',
  'Kullanıcının gündelik selamlaşma, teşekkür veya kısa nezaket mesajına aynı dilde doğal ve çok kısa yanıt ver.',
  'Kullanıcı istemedikçe Enerjisa, SAP, süreç, teknik talep, yetenek listesi veya soru menüsü ekleme.',
  'Yanıtı en fazla iki kısa cümle tut.',
].join('\n')

const normalizeConversationText = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const TRIVIAL_CONVERSATION_PATTERN = /^(?:selam(?:lar)?|merhaba|hey|hi|hello|gunaydin|iyi aksamlar|iyi geceler|nasilsin|naber|tesekkur(?:ler)?|tesekkur ederim|sag ol|sagol|eyvallah|tamam|ok|okay)$/i

const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

export interface TrivialAssistantFastPathInput {
  message: string
  model: string
  attachmentCount: number
}

export interface TrivialAssistantFastPathResult {
  text: string
  model: string
  provider: TrivialFastPathProvider
  usage?: Record<string, number>
  fallbackUsed: false
}

export const providerForTrivialFastPathModel = (model: string): TrivialFastPathProvider => (
  model === 'auto' || GEMINI_FAST_PATH_MODELS.has(model) ? 'gemini' : 'openai'
)

export const executionModelForTrivialFastPathModel = (model: string): string => (
  model === 'auto' || model === 'gemini-3.1-pro-preview' || model === DEPRECATED_GEMINI_FLASH_LITE_PREVIEW
    ? TRIVIAL_GEMINI_LATENCY_MODEL
    : model
)

export const shouldUseTrivialAssistantFastPath = (input: TrivialAssistantFastPathInput): boolean => {
  const model = cleanString(input.model, 80)
  if (!model) return false
  if (model !== 'auto' && !GEMINI_FAST_PATH_MODELS.has(model) && !OPENAI_FAST_PATH_MODELS.has(model)) return false
  // An exact greeting/thanks is context-free by definition. Stale attachment state
  // must not force it through semantic orchestration; context-sensitive acknowledgements
  // such as "tamam" remain blocked by the gateway before this helper is called.
  return TRIVIAL_CONVERSATION_PATTERN.test(normalizeConversationText(input.message))
}

const extractOpenAiText = (payload: Record<string, unknown>): string => {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim()
  if (!Array.isArray(payload.output)) return ''

  const chunks: string[] = []
  for (const item of payload.output as Array<Record<string, unknown>>) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content as Array<Record<string, unknown>>) {
      if ((part.type === 'output_text' || part.type === 'refusal') && typeof part.text === 'string') {
        chunks.push(part.text)
      }
    }
  }
  return chunks.join('').trim()
}

const numericUsage = (value: unknown): Record<string, number> | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const usage = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, candidate]) => typeof candidate === 'number' && Number.isFinite(candidate)),
  ) as Record<string, number>
  return Object.keys(usage).length ? usage : undefined
}

async function requestOpenAiTrivialResponse(input: {
  apiKey: string
  model: string
  message: string
}): Promise<TrivialAssistantFastPathResult> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      instructions: TRIVIAL_FAST_PATH_INSTRUCTIONS,
      input: [{ role: 'user', content: input.message }],
      max_output_tokens: 320,
      text: { verbosity: 'low' },
      store: false,
    }),
  })

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = payload.error && typeof payload.error === 'object'
      ? cleanString((payload.error as Record<string, unknown>).message, 1_000)
      : ''
    throw new Error(error || `OpenAI Responses API returned ${response.status}.`)
  }

  const text = extractOpenAiText(payload)
  if (!text) throw new Error('OpenAI trivial fast path completed without a visible answer.')

  return {
    text,
    model: input.model,
    provider: 'openai',
    usage: numericUsage(payload.usage),
    fallbackUsed: false,
  }
}

const extractGeminiVisibleText = (payload: Record<string, unknown>): string => {
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates as Array<Record<string, unknown>>
    : []
  const content = candidates[0]?.content
  const parts = content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts)
    ? (content as Record<string, unknown>).parts as Array<Record<string, unknown>>
    : []
  return parts
    .filter(part => part.thought !== true && typeof part.text === 'string')
    .map(part => String(part.text))
    .join('')
    .trim()
}

async function requestGeminiTrivialResponse(input: {
  apiKey: string
  model: string
  message: string
}): Promise<TrivialAssistantFastPathResult> {
  // Exact trivial turns are latency-sensitive and do not need the shared
  // reasoning/document provider stack. Use the REST API directly so the Edge
  // isolate does not need to resolve and initialize the Google SDK first.
  const thinkingLevel = input.model === TRIVIAL_GEMINI_LATENCY_MODEL || input.model === 'gemini-3.5-flash-lite'
    ? 'minimal'
    : 'low'
  const response = await fetch(
    `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': input.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: TRIVIAL_FAST_PATH_INSTRUCTIONS }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: input.message }],
        }],
        generationConfig: {
          maxOutputTokens: 160,
          thinkingConfig: {
            thinkingLevel,
          },
        },
      }),
    },
  )

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = payload.error && typeof payload.error === 'object'
      ? cleanString((payload.error as Record<string, unknown>).message, 1_000)
      : ''
    throw new Error(error || `Gemini GenerateContent API returned ${response.status}.`)
  }

  const visibleText = extractGeminiVisibleText(payload)
  if (!visibleText) throw new Error('Gemini trivial fast path completed without a visible answer.')

  const metadata = payload.usageMetadata && typeof payload.usageMetadata === 'object'
    ? payload.usageMetadata as Record<string, unknown>
    : {}
  return {
    text: visibleText,
    model: input.model,
    provider: 'gemini',
    usage: {
      input_tokens: Number(metadata.promptTokenCount || 0),
      output_tokens: Number(metadata.candidatesTokenCount || 0),
      reasoning_tokens: Number(metadata.thoughtsTokenCount || 0),
      total_tokens: Number(metadata.totalTokenCount || 0),
    },
    fallbackUsed: false,
  }
}

export async function requestTrivialAssistantResponse(input: {
  message: string
  model: string
  openAiApiKey?: string
  geminiApiKey?: string
}): Promise<TrivialAssistantFastPathResult> {
  const provider = providerForTrivialFastPathModel(input.model)
  if (provider === 'gemini') {
    if (!input.geminiApiKey) {
      if (input.model === 'auto' && input.openAiApiKey) {
        return requestOpenAiTrivialResponse({
          apiKey: input.openAiApiKey,
          model: 'gpt-5.6-sol',
          message: input.message,
        })
      }
      throw new Error('GEMINI_API_KEY is not configured for the selected model.')
    }
    return requestGeminiTrivialResponse({
      apiKey: input.geminiApiKey,
      model: executionModelForTrivialFastPathModel(input.model),
      message: input.message,
    })
  }

  if (!input.openAiApiKey) throw new Error('OPENAI_API_KEY is not configured for the selected model.')
  return requestOpenAiTrivialResponse({
    apiKey: input.openAiApiKey,
    model: input.model,
    message: input.message,
  })
}
