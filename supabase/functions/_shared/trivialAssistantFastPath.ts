import {
  GEMINI_MODELS,
  OPENAI_MODELS,
  isTrivialConversationalTurn,
  providerForModel,
  requestGeminiResponse,
  type AssistantProvider,
} from './modelProviders.ts'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export const TRIVIAL_FAST_PATH_ENGINE_VERSION = 'trivial-fast-path-v1'

const TRIVIAL_FAST_PATH_INSTRUCTIONS = [
  'Sen JetWork AI asistanısın.',
  'Kullanıcının gündelik selamlaşma, teşekkür veya kısa nezaket mesajına aynı dilde doğal ve çok kısa yanıt ver.',
  'Kullanıcı istemedikçe Enerjisa, SAP, süreç, teknik talep, yetenek listesi veya soru menüsü ekleme.',
  'Yanıtı en fazla iki kısa cümle tut.',
].join('\n')

const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

export interface TrivialAssistantFastPathInput {
  message: string
  model: string
  attachmentCount: number
}

export interface TrivialAssistantFastPathResult {
  text: string
  model: string
  provider: AssistantProvider
  usage?: Record<string, number>
  fallbackUsed: false
}

export const shouldUseTrivialAssistantFastPath = (input: TrivialAssistantFastPathInput): boolean => {
  const model = cleanString(input.model, 80)
  if (!model || model === 'auto' || input.attachmentCount > 0) return false
  if (!GEMINI_MODELS.has(model) && !OPENAI_MODELS.has(model)) return false
  return isTrivialConversationalTurn([{ role: 'user', content: input.message }])
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
    // Persist the configured model id, not a provider-resolved snapshot id that
    // may violate the assistant_conversations model constraint.
    model: input.model,
    provider: 'openai',
    usage: numericUsage(payload.usage),
    fallbackUsed: false,
  }
}

export async function requestTrivialAssistantResponse(input: {
  message: string
  model: string
  openAiApiKey?: string
  geminiApiKey?: string
}): Promise<TrivialAssistantFastPathResult> {
  const provider = providerForModel(input.model)
  if (provider === 'gemini') {
    if (!input.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured for the selected model.')
    let visibleText = ''
    const response = await requestGeminiResponse({
      apiKey: input.geminiApiKey,
      model: input.model,
      instructions: TRIVIAL_FAST_PATH_INSTRUCTIONS,
      items: [{ role: 'user', content: input.message }],
      tools: [],
      allowTools: false,
      maxOutputTokens: 160,
      onText: delta => { visibleText += delta },
    })
    if (!visibleText.trim()) throw new Error('Gemini trivial fast path completed without a visible answer.')
    return {
      text: visibleText.trim(),
      model: input.model,
      provider: 'gemini',
      usage: response.usage,
      fallbackUsed: false,
    }
  }

  if (!input.openAiApiKey) throw new Error('OPENAI_API_KEY is not configured for the selected model.')
  return requestOpenAiTrivialResponse({
    apiKey: input.openAiApiKey,
    model: input.model,
    message: input.message,
  })
}
