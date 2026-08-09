import { runRequiredWebResearch, type ReasoningComplexity, type ReasoningSourceRef, type WebResearchResult } from './reasoningEngineLegacy.ts'
import type { AssistantProvider } from './modelProviders.ts'

const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const safeUrl = (value: unknown) => {
  const raw = String(value || '').trim()
  return /^https?:\/\//i.test(raw) ? raw.slice(0, 2_000) : ''
}

const uniqueSources = (sources: ReasoningSourceRef[]) => {
  const seen = new Set<string>()
  return sources.filter(source => {
    const key = `${source.url || ''}|${source.sourceName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 20)
}

const geminiText = (payload: Record<string, unknown>) => {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates as Array<Record<string, unknown>> : []
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

const geminiGrounding = (payload: Record<string, unknown>) => {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates as Array<Record<string, unknown>> : []
  const metadata = candidates[0]?.groundingMetadata && typeof candidates[0].groundingMetadata === 'object'
    ? candidates[0].groundingMetadata as Record<string, unknown>
    : {}
  const chunks = Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks as Array<Record<string, unknown>> : []
  const sources: ReasoningSourceRef[] = []
  for (const chunk of chunks) {
    const web = chunk.web && typeof chunk.web === 'object' ? chunk.web as Record<string, unknown> : null
    if (!web) continue
    const url = safeUrl(web.uri || web.url)
    if (!url) continue
    const title = String(web.title || '').trim().slice(0, 500)
    let sourceName = title
    if (!sourceName) {
      try { sourceName = new URL(url).hostname.replace(/^www\./, '') } catch { sourceName = 'Web kaynağı' }
    }
    sources.push({ sourceName, title: title || undefined, url, sourceType: 'web' })
  }
  const queries = Array.isArray(metadata.webSearchQueries)
    ? metadata.webSearchQueries.map(item => String(item || '').trim()).filter(Boolean)
    : []
  return { sources: uniqueSources(sources), searchCount: queries.length }
}

const runGeminiWebResearch = async (input: {
  apiKey: string
  model: string
  query: string
  complexity: ReasoningComplexity
  signal?: AbortSignal
}): Promise<WebResearchResult> => {
  const response = await fetch(`${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'x-goog-api-key': input.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: [
            'Act only as an evidence researcher for JetWork.',
            'Use Google Search to collect concise factual evidence relevant to the query.',
            'Prefer primary, official and recent sources. Do not invent internal company facts.',
            'Return concise evidence notes; the final user answer will be produced by another stage.',
          ].join('\n'),
        }],
      },
      contents: [{ role: 'user', parts: [{ text: input.query.slice(0, 1_500) }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        maxOutputTokens: 4_000,
        thinkingConfig: { thinkingLevel: input.complexity === 'high' ? 'medium' : 'low' },
      },
    }),
  })

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const detail = (payload.error as Record<string, unknown> | undefined)?.message
    throw new Error(String(detail || `Gemini web research failed with ${response.status}.`))
  }

  const grounding = geminiGrounding(payload)
  const usageMetadata = payload.usageMetadata && typeof payload.usageMetadata === 'object'
    ? payload.usageMetadata as Record<string, unknown>
    : {}
  return {
    text: geminiText(payload).slice(0, 18_000),
    sources: grounding.sources,
    searchCount: grounding.searchCount,
    usage: {
      input_tokens: Number(usageMetadata.promptTokenCount || 0),
      output_tokens: Number(usageMetadata.candidatesTokenCount || 0),
      reasoning_tokens: Number(usageMetadata.thoughtsTokenCount || 0),
      total_tokens: Number(usageMetadata.totalTokenCount || 0),
    },
  }
}

export async function runProviderWebResearch(input: {
  provider: AssistantProvider
  apiKey?: string
  model: string
  query: string
  complexity: ReasoningComplexity
  signal?: AbortSignal
}): Promise<WebResearchResult> {
  if (!input.apiKey) return { text: '', sources: [], searchCount: 0 }
  if (input.provider === 'gemini') {
    return runGeminiWebResearch({
      apiKey: input.apiKey,
      model: input.model,
      query: input.query,
      complexity: input.complexity,
      signal: input.signal,
    })
  }
  return runRequiredWebResearch({
    apiKey: input.apiKey,
    model: input.model,
    query: input.query,
    complexity: input.complexity,
    signal: input.signal,
  })
}
