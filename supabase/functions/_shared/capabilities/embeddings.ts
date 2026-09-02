import { GoogleGenAI } from '@google/genai'

export const CAPABILITY_EMBEDDING_MODEL = 'gemini-embedding-001'
export const CAPABILITY_EMBEDDING_DIMENSIONS = 768

const clean = (value: unknown, max = 24_000) => String(value ?? '').trim().slice(0, max)

const embedOne = async (input: {
  apiKey: string
  text: string
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'
}) => {
  const text = clean(input.text)
  if (!text) throw new Error('Capability embedding text is required.')
  const ai = new GoogleGenAI({ apiKey: input.apiKey })
  const response = await ai.models.embedContent({
    model: CAPABILITY_EMBEDDING_MODEL,
    contents: text,
    config: {
      taskType: input.taskType,
      outputDimensionality: CAPABILITY_EMBEDDING_DIMENSIONS,
    },
  })
  const embedding = response.embeddings?.[0]?.values
  if (!embedding || embedding.length !== CAPABILITY_EMBEDDING_DIMENSIONS) {
    throw new Error('Capability embedding response is invalid.')
  }
  return embedding.map(Number)
}

export const embedCapabilityQuery = (apiKey: string, query: string) => embedOne({
  apiKey,
  text: query,
  taskType: 'RETRIEVAL_QUERY',
})

export const embedCapabilityDocument = (apiKey: string, semanticText: string) => embedOne({
  apiKey,
  text: semanticText,
  taskType: 'RETRIEVAL_DOCUMENT',
})

export async function embedCapabilityDocuments(
  apiKey: string,
  semanticTexts: readonly string[],
  concurrency = 4,
): Promise<number[][]> {
  const results: number[][] = new Array(semanticTexts.length)
  const workerCount = Math.max(1, Math.min(Math.trunc(concurrency) || 4, 8, semanticTexts.length || 1))
  let cursor = 0
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= semanticTexts.length) return
      results[index] = await embedCapabilityDocument(apiKey, semanticTexts[index])
    }
  })
  await Promise.all(workers)
  return results
}
