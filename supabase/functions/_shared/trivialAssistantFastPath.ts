const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export const TRIVIAL_FAST_PATH_ENGINE_VERSION = 'trivial-fast-path-v6-universal-short-turn'
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
  'Bu yol kısa, gündelik ve düşük riskli kullanıcı mesajları içindir. Aynı dilde doğal ve kısa yanıt ver.',
  'Çok olası yazım hatası veya kısaltmayı sessizce anlamlandır. Örneğin gündelik bir selamlaşmanın hatalı yazımını teknik terim veya araştırma konusu gibi yorumlama.',
  'Kullanıcı yalnız bir kişi, takım, kurum, ürün veya konu adı yazdıysa niyet uydurma; tek kısa soruyla neyi merak ettiğini sor.',
  'Kısa bir gündelik emir veya hatırlatma cümlesine doğal karşılık ver; gerçekte planlamadığın, kaydetmediğin veya gelecekte yapamayacağın bir işlemi yaptığını iddia etme.',
  'Kullanıcı istemedikçe önceki teknik/kurumsal konuyu taşıma ve Enerjisa, SAP, CRM, süreç, proje, analiz veya IT talebine yönlendirme yapma.',
  'Selamlaşma ifadesini başka bir selamlaşma biçimine dönüştürme; örneğin "selam" ifadesine "aleykümselam" deme.',
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

const TRIVIAL_CONVERSATION_PATTERN = /^(?:selam(?:lar)?|merhaba|selamun aleykum|selam aleykum|sa|hey|hi|hello|gunaydin|iyi aksamlar|iyi geceler|nasilsin|nasil gidiyor|ne haber|naber|iyi misin|how are you|how s it going|thanks|thank you|tesekkur(?:ler)?|tesekkur ederim|sag ol|sagol|eyvallah|tamam|ok|okay)$/i
const ENTERPRISE_OR_TECHNICAL_SHORT_PATTERN = /(?:\bSAP\b|\bCRM\b|\bC4C\b|\bIS[- ]?U\b|\bFICA\b|\bABAP\b|\bJIRA\b|\bENERJISA\b|\bCHECK_[A-Z0-9_]+\b|\bZ[A-Z0-9_]{2,}\b|\b[A-Z][A-Z0-9_]{2,}(?:[-_/][A-Z0-9_]{1,})+\b)/i
const EXPLICIT_INFORMATION_OR_ARTIFACT_PATTERN = /(?:\?|\b(?:nedir|kimdir|kim|nerede|ne zaman|nasil|neden|niye|hangi|hakkinda|anlat|acikla|bilgi|guncel|son durum|durum|performans|haber|fiyat|hava|kac|what|who|where|when|how|why|latest|current|news|ara|arastir|bul|listele|analiz et|hazirla|olustur|yaz|kod|rapor|sunum|dokuman|excel|ppt|pdf)\b)/i

const DETERMINISTIC_TRIVIAL_RESPONSES = new Map<string, string>([
  ['selam', 'Selam! Nasıl yardımcı olabilirim?'],
  ['selamlar', 'Selam! Nasıl yardımcı olabilirim?'],
  ['merhaba', 'Merhaba! Nasıl yardımcı olabilirim?'],
  ['selamun aleykum', 'Aleykümselam! Nasıl yardımcı olabilirim?'],
  ['selam aleykum', 'Aleykümselam! Nasıl yardımcı olabilirim?'],
  ['sa', 'Aleykümselam! Nasıl yardımcı olabilirim?'],
  ['hey', 'Hey! Nasıl yardımcı olabilirim?'],
  ['hi', 'Hi! How can I help?'],
  ['hello', 'Hello! How can I help?'],
  ['gunaydin', 'Günaydın! Nasıl yardımcı olabilirim?'],
  ['iyi aksamlar', 'İyi akşamlar! Nasıl yardımcı olabilirim?'],
  ['iyi geceler', 'İyi geceler! Nasıl yardımcı olabilirim?'],
  ['nasilsin', 'İyiyim, teşekkürler. Sen nasılsın?'],
  ['nasil gidiyor', 'İyi gidiyor, teşekkürler. Sende nasıl gidiyor?'],
  ['ne haber', 'İyiyim, teşekkürler. Senden ne haber?'],
  ['naber', 'İyiyim, teşekkürler. Senden ne haber?'],
  ['iyi misin', 'İyiyim, teşekkürler. Sen nasılsın?'],
  ['how are you', 'I’m doing well, thanks. How are you?'],
  ['how s it going', 'It’s going well, thanks. How’s it going for you?'],
  ['thanks', 'You’re welcome!'],
  ['thank you', 'You’re welcome!'],
  ['tesekkur', 'Rica ederim!'],
  ['tesekkurler', 'Rica ederim!'],
  ['tesekkur ederim', 'Rica ederim!'],
  ['sag ol', 'Rica ederim!'],
  ['sagol', 'Rica ederim!'],
  ['eyvallah', 'Rica ederim!'],
])

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

export const deterministicTrivialResponseForMessage = (message: string): string | null => (
  DETERMINISTIC_TRIVIAL_RESPONSES.get(normalizeConversationText(message)) || null
)

export const shouldUseTrivialAssistantFastPath = (input: TrivialAssistantFastPathInput): boolean => {
  const model = cleanString(input.model, 80)
  if (!model) return false
  if (model !== 'auto' && !GEMINI_FAST_PATH_MODELS.has(model) && !OPENAI_FAST_PATH_MODELS.has(model)) return false

  const normalized = normalizeConversationText(input.message)
  if (!normalized) return false

  // Canonical social turns remain deterministic and context-free.
  if (TRIVIAL_CONVERSATION_PATTERN.test(normalized)) return true

  // A bounded universal short-turn lane handles typos, abbreviations, reactions
  // and low-risk daily language without forcing every possible phrase into a regex.
  // Attachments and anything that looks technical, informational or artifact-producing
  // stay on semantic orchestration.
  if (input.attachmentCount > 0) return false
  if (input.message.length > 96) return false
  if (ENTERPRISE_OR_TECHNICAL_SHORT_PATTERN.test(input.message)) return false
  if (EXPLICIT_INFORMATION_OR_ARTIFACT_PATTERN.test(normalized)) return false

  const words = normalized.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 7
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
  const deterministicText = deterministicTrivialResponseForMessage(input.message)
  if (deterministicText) {
    return {
      text: deterministicText,
      model: executionModelForTrivialFastPathModel(input.model),
      provider,
      usage: { deterministic_fast_path: 1 },
      fallbackUsed: false,
    }
  }

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
