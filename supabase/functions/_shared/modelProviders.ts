import { GoogleGenAI } from 'npm:@google/genai@1.52.0'

export const OPENAI_MODELS = new Set(['gpt-5.6-sol', 'gpt-5.6'])
export const GEMINI_MODELS = new Set([
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
])

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'

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

const parseToolOutput = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const toGeminiContents = (items: Array<Record<string, unknown>>) => {
  const contents: Array<Record<string, unknown>> = []
  const callNames = new Map<string, string>()

  for (const item of items) {
    const type = String(item.type || '')
    const role = String(item.role || '')
    const geminiContent = item._geminiContent

    if (type === 'function_call') {
      callNames.set(
        String(item.call_id || ''),
        String(item.name || ''),
      )
    }

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
      try {
        args = JSON.parse(String(item.arguments || '{}'))
      } catch {
        args = {}
      }
      contents.push({
        role: 'model',
        parts: [{
          functionCall: { id: callId, name, args },
        }],
      })
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
  const config: Record<string, unknown> = {
    systemInstruction: input.instructions,
    maxOutputTokens: input.maxOutputTokens,
    abortSignal: input.signal,
  }

  if (input.allowTools) {
    config.tools = [{
      functionDeclarations: input.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      })),
    }]
    config.toolConfig = {
      functionCallingConfig: { mode: 'AUTO' },
    }
  }

  const response = await ai.models.generateContent({
    model: input.model,
    contents: toGeminiContents(input.items),
    config,
  } as any)

  const candidateContent = (response as any)?.candidates?.[0]?.content
  const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : []
  const visibleText = parts
    .filter((part: any) => !part?.thought && typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('')
  if (visibleText) input.onText(visibleText)

  const functionCalls = parts.filter((part: any) => part?.functionCall)
  const output = functionCalls.length
    ? functionCalls.map((part: any) => {
        const call = part.functionCall || {}
        return {
          type: 'function_call',
          call_id: String(call.id || crypto.randomUUID()),
          name: String(call.name || ''),
          arguments: JSON.stringify(call.args || {}),
          _geminiContent: { role: 'model', parts: [part] },
        }
      })
    : [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: visibleText, annotations: [] }],
        _geminiContent: candidateContent,
      }]

  const metadata = (response as any)?.usageMetadata || {}
  return {
    id: String((response as any)?.responseId || crypto.randomUUID()),
    status: 'completed',
    model: input.model,
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
  const { _geminiContent: _metadata, ...clean } = item
  return clean
})
