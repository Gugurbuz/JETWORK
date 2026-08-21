import { requestGeminiResponse as qualityRequest, type NormalizedModelResponse } from './modelProvidersPrimaryRuntimeQuality.ts'
import { requestGeminiResponse as rawRequest } from './modelProviders.ts'

export * from './modelProvidersPrimaryRuntimeQuality.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const completeMessageEnumeration = (items: Array<Record<string, unknown>>) => {
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const payload: any = parse(item.output)
    const records = payload?.records
    if (
      payload?.tool === 'list_knowledge_catalog' &&
      records?.complete === true &&
      Array.isArray(records.items) &&
      records.items.length > 0 &&
      records.items.every((record: any) => String(record?.objectType || '') === 'message')
    ) return records.items
  }
  return null
}

const renderCompleteMessageList = (input: any, rows: any[]): NormalizedModelResponse => {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const row of rows) {
    const key = String(row.canonicalKey || row.title || '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    const title = String(row.title || row.name || '').trim()
    const match = title.match(/^([^—]+)\s*—\s*(.+)$/)
    lines.push(match ? `- **${match[1].trim()}** — ${match[2].trim()}` : `- ${title}`)
  }
  const text = lines.join('\n')
  input.onText(text)
  return {
    id: `jetwork-complete-message-list:${crypto.randomUUID()}`,
    status: 'completed',
    model: String(input.model || 'gemini-3.5-flash'),
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { deterministic_complete_message_list_render: 1, deterministic_provider_calls_avoided: 1 },
  }
}

const toolNameMap = (items: Array<Record<string, unknown>>) => {
  const names = new Map<string, string>()
  for (const item of items || []) {
    if (String(item?.type || '') === 'function_call') names.set(String(item.call_id || ''), String(item.name || ''))
  }
  return names
}

const payloadRecords = (payload: any): any[] => {
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.records?.items)) return payload.records.items
  return []
}

const documentEvidence = (items: Array<Record<string, unknown>>) => {
  const names = toolNameMap(items)
  const exactOutputs: string[] = []
  const verifiedKeys = new Set<string>()
  const searchPayloads: any[] = []

  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const name = names.get(String(item.call_id || '')) || ''
    const payload: any = parse(item.output)
    if (name === 'get_document_content') {
      for (const record of payloadRecords(payload)) {
        const key = String(record?.canonicalKey || '')
        if (key) verifiedKeys.add(key)
      }
      exactOutputs.push(String(item.output || ''))
    } else if (name === 'search_document') {
      searchPayloads.push(payload)
    }
  }

  if (!exactOutputs.length) return ''

  const relevantChunks: any[] = []
  for (const payload of searchPayloads) {
    for (const record of payloadRecords(payload)) {
      const key = String(record?.canonicalKey || '')
      if (!key || !verifiedKeys.has(key)) continue
      const excerpt = String(record?.evidenceExcerpt || '').trim()
      if (!excerpt) continue
      relevantChunks.push({
        canonicalKey: key,
        title: String(record?.title || ''),
        evidenceExcerpt: excerpt.slice(0, 4_500),
        chunkIndex: record?.chunkIndex ?? null,
      })
    }
  }

  const uniqueChunks: any[] = []
  const seen = new Set<string>()
  for (const chunk of relevantChunks) {
    const key = `${chunk.canonicalKey}|${chunk.chunkIndex}|${chunk.evidenceExcerpt}`
    if (seen.has(key)) continue
    seen.add(key)
    uniqueChunks.push(chunk)
    if (uniqueChunks.length >= 5) break
  }

  const chunkBlock = uniqueChunks.length
    ? `[VERIFIED_RELEVANT_DOCUMENT_CHUNKS]\n${JSON.stringify(uniqueChunks)}\n[END_VERIFIED_RELEVANT_DOCUMENT_CHUNKS]\n\n`
    : ''
  const exactBlock = exactOutputs.join('\n\n').slice(0, 12_000)
  return `${chunkBlock}[VERIFIED_EXACT_DOCUMENT]\n${exactBlock}\n[END_VERIFIED_EXACT_DOCUMENT]`.slice(0, 20_000)
}

const conversationItems = (items: Array<Record<string, unknown>>) => (items || [])
  .filter((item: any) => {
    const role = String(item?.role || '')
    const type = String(item?.type || '')
    return (!type && (role === 'user' || role === 'assistant')) || type === 'message'
  })
  .slice(-8)
  .map((item: any) => ({
    role: String(item.role || 'assistant'),
    content: typeof item.content === 'string'
      ? item.content
      : Array.isArray(item.content)
        ? item.content.map((part: any) => part?.text || '').join('\n')
        : '',
  }))
  .filter((item: any) => item.content)

async function synthesizeFullDocument(input: any, document: string) {
  return rawRequest({
    ...input,
    instructions: `${input.instructions}\n\n[JETWORK VERIFIED LONG DOCUMENT SYNTHESIS]\nThe exact document fetch below verifies the document identity. VERIFIED_RELEVANT_DOCUMENT_CHUNKS are excerpts returned by search from that same verified canonical document and may be used as literal document evidence. Prefer the relevant chunks for the user's specific question, while using the exact document block for surrounding context. Do not invent details absent from both.`,
    items: [
      ...conversationItems(input.items),
      { role: 'user', content: `[JETWORK_VERIFIED_DOCUMENT_EVIDENCE]\n${document}\n[END_JETWORK_VERIFIED_DOCUMENT_EVIDENCE]` },
    ],
    tools: [],
    allowTools: false,
  })
}

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const rows = completeMessageEnumeration(input.items || [])
  if (rows?.length) return renderCompleteMessageList(input, rows)

  const document = documentEvidence(input.items || [])
  if (document && input.allowTools) return synthesizeFullDocument(input, document)

  return qualityRequest(input)
}
