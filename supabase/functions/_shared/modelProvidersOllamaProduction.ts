import {
  requestGeminiResponse as baseRequestGeminiResponse,
  type NormalizedModelResponse,
} from './modelProviders.ts?ollama-production-base=1'
import { extractSemanticPlanFromItems } from './geminiCostGuard.ts'
import { hasExactTechnicalIdentifier } from './technicalIdentifier.ts'

// Preserve the current production provider surface (including Ollama) while
// retaining the buffered exact-identifier timeout recovery that production uses
// for Gemini direct turns.
export * from './modelProviders.ts?ollama-production-base=1'

const EXPLICIT_PRO_MODEL = 'gemini-3.1-pro-preview'

type GeminiRequest = {
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
}

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const candidate = part as Record<string, unknown>
    return typeof candidate.text === 'string' ? candidate.text : ''
  }).filter(Boolean).join('\n')
}

const lastUserText = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (String(item.role || '') !== 'user') continue
    const text = textFromContent(item.content)
    if (text) return text
  }
  return ''
}

const errorText = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>
    return String(candidate.message || candidate.status || candidate.code || '')
  }
  return String(error || '')
}

const isTransientTimeout = (error: unknown) => (
  /provider attempt timed out|TimeoutError|DEADLINE_EXCEEDED|408|504/i.test(errorText(error))
)

const mergeUsage = (
  response: NormalizedModelResponse,
  extra: Record<string, number>,
): NormalizedModelResponse => ({
  ...response,
  usage: {
    ...((response.usage && typeof response.usage === 'object') ? response.usage : {}),
    ...extra,
  },
})

const shouldUseBufferedDirectRecovery = (input: GeminiRequest) => {
  if (input.model === EXPLICIT_PRO_MODEL) return false
  const plan = extractSemanticPlanFromItems(input.items)
  if (!plan) return false
  if (plan.executionMode !== 'direct') return false
  if (plan.webMode !== 'none') return false
  if (plan.knowledgeRequired === true || plan.enterpriseGroundingRequired === true) return false
  return hasExactTechnicalIdentifier(lastUserText(input.items))
}

export async function requestGeminiResponse(input: GeminiRequest): Promise<NormalizedModelResponse> {
  if (!shouldUseBufferedDirectRecovery(input)) return baseRequestGeminiResponse(input)

  let bufferedText = ''
  try {
    const response = await baseRequestGeminiResponse({
      ...input,
      onText: delta => { bufferedText += delta },
    })
    if (bufferedText) input.onText(bufferedText)
    return mergeUsage(response, { buffered_exact_identifier_provider_call: 1 })
  } catch (error) {
    if (input.signal?.aborted || !isTransientTimeout(error)) throw error

    console.warn('BUFFERED_EXACT_IDENTIFIER_TIMEOUT_RECOVERY', {
      model: input.model,
      error: errorText(error).slice(0, 500),
    })

    let recoveryText = ''
    const recovery = await baseRequestGeminiResponse({
      ...input,
      tools: [],
      allowTools: false,
      allowProviderWeb: false,
      onText: delta => { recoveryText += delta },
    })
    if (recoveryText) input.onText(recoveryText)
    return mergeUsage(recovery, {
      buffered_exact_identifier_provider_call: 1,
      buffered_exact_identifier_timeout_recovery: 1,
    })
  }
}
