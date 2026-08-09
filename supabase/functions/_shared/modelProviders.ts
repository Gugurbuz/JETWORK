import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  GEMINI_SUBSTANTIVE_MODEL,
  OPENAI_MODELS,
  isTrivialConversationalTurn as legacyIsTrivialConversationalTurn,
  providerForModel,
  requestGeminiResponse as legacyRequestGeminiResponse,
  type AssistantProvider,
  type NormalizedModelResponse,
} from './modelProvidersLegacy.ts'

export {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  GEMINI_SUBSTANTIVE_MODEL,
  OPENAI_MODELS,
  providerForModel,
}
export type { AssistantProvider, NormalizedModelResponse }

const INTERNAL_SEMANTIC_PLAN_PATTERN = /\n?\[JETWORK_SEMANTIC_PLAN\][\s\S]*?\[END_JETWORK_SEMANTIC_PLAN\]\s*/gi

export const stripInternalSemanticPlan = (value: string) => value
  .replace(INTERNAL_SEMANTIC_PLAN_PATTERN, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const sanitizeContent = (content: unknown): unknown => {
  if (typeof content === 'string') return stripInternalSemanticPlan(content)
  if (!Array.isArray(content)) return content
  return content.map(part => {
    if (typeof part === 'string') return stripInternalSemanticPlan(part)
    if (!part || typeof part !== 'object') return part
    const clean = { ...(part as Record<string, unknown>) }
    if (typeof clean.text === 'string') clean.text = stripInternalSemanticPlan(clean.text)
    return clean
  })
}

const sanitizeItems = (items: Array<Record<string, unknown>>) => items.map(item => {
  const clean = { ...item }
  if ('content' in clean) clean.content = sanitizeContent(clean.content)
  return clean
})

export const isTrivialConversationalTurn = (items: Array<Record<string, unknown>>) => (
  legacyIsTrivialConversationalTurn(sanitizeItems(items))
)

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
  return legacyRequestGeminiResponse({ ...input, items: sanitizeItems(input.items) })
}

export const cleanProviderItemsForOpenAi = (
  items: Array<Record<string, unknown>>,
) => sanitizeItems(items).map(item => {
  const { _geminiContent: _metadata, ...clean } = item
  return clean
})
