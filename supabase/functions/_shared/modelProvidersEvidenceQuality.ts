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

const documentEvidence = (items: Array<Record<string, unknown>>) => {
  const toolNames = new Map<string, string>()
  for (const item of items || []) {
    if (String(item?.type || '') === 'function_call') toolNames.set(String(item.call_id || ''), String(item.name || ''))
  }
  const documents: string[] = []
  for (const item of items || []) {
    if (
      String(item?.type || '') === 'function_call_output' &&
      toolNames.get(String(item.call_id || '')) === 'get_document_content'
    ) documents.push(String(item.output || ''))
  }
  return documents.join('\n\n').slice(0, 12_000)
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
    instructions: `${input.instructions}\n\n[JETWORK FULL DOCUMENT SYNTHESIS]\nAşağıdaki seçilmiş ve doğrulanmış tam doküman kanıtını doğrudan kullan. Kullanıcı bir sürecin nasıl yapıldığını soruyorsa, dokümanda bulunan ana işlem sırasını başlangıçtan işlemin tamamlanması/kaydedilmesine kadar atlamadan anlat. Kanıtta olmayan ayrıntı üretme.`,
    items: [
      ...conversationItems(input.items),
      { role: 'user', content: `[JETWORK_FULL_DOCUMENT_EVIDENCE]\n${document}\n[END_JETWORK_FULL_DOCUMENT_EVIDENCE]` },
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
