import { requestGeminiResponse as baseRequestGeminiResponse, type NormalizedModelResponse } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/38177ae051973d5d318e3bd37e94f6fc3879041b/supabase/functions/_shared/modelProviders.ts'
import { buildGeminiFinalSynthesisItems } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/38177ae051973d5d318e3bd37e94f6fc3879041b/supabase/functions/_shared/geminiCostGuard.ts'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/38177ae051973d5d318e3bd37e94f6fc3879041b/supabase/functions/_shared/modelProviders.ts'

const hasEvidence = (items: Array<Record<string, unknown>>) => items.some(item => String(item.type || '') === 'function_call_output')
const hasFunctionCalls = (response: NormalizedModelResponse) => (response.output || []).some(item => String(item.type || '') === 'function_call')
const responseText = (response: NormalizedModelResponse) => (response.output || [])
  .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
  .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
  .map((part: any) => part.text)
  .join('')
const parse = (value: unknown) => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null } }

const completeEnumeration = (items: Array<Record<string, unknown>>) => items.some(item => {
  if (String(item.type || '') !== 'function_call_output') return false
  const payload: any = parse(item.output)
  return payload?.tool === 'list_knowledge_catalog'
    && payload?.records?.complete === true
    && Number(payload?.records?.returnedCount || payload?.records?.items?.length || 0) > 0
})

const lastUserText = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (String(items[index].role || '') === 'user' && typeof items[index].content === 'string') return String(items[index].content)
  }
  return ''
}
const messageListQuestion = (items: Array<Record<string, unknown>>) => /(hangi\s+(?:hata\s+)?mesaj|mesajlar[ıi]?\s+(?:neler|nedir)|hangi\s+hatalar)/i.test(lastUserText(items))

const messageRows = (items: Array<Record<string, unknown>>) => {
  const rows: any[] = []
  for (const item of items) {
    if (String(item.type || '') !== 'function_call_output') continue
    const payload: any = parse(item.output)
    const records = payload?.records
    if (Array.isArray(records)) {
      for (const record of records) if (String(record?.objectType || '') === 'message') rows.push(record)
    } else if (records && Array.isArray(records.items)) {
      for (const record of records.items) if (String(record?.objectType || '') === 'message') rows.push(record)
    }
  }
  const seen = new Set<string>()
  return rows.filter(record => {
    const key = String(record?.canonicalKey || record?.title || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const deterministicMessageList = (input: any, rows: any[]): NormalizedModelResponse => {
  const lines = rows.map(record => {
    const title = String(record.title || record.name || '').trim()
    const match = title.match(/^([^—-]+(?:-[0-9]+)?)\s*[—-]\s*(.+)$/)
    return match ? `- **${match[1].trim()}** — ${match[2].trim()}` : `- ${title}`
  }).filter((line: string) => line !== '- ')
  const text = lines.join('\n')
  input.onText(text)
  return {
    id: `jetwork-message-list:${crypto.randomUUID()}`,
    status: 'completed',
    // Preserve the actual requested/provider model. The runtime persists this
    // field into assistant_conversations, whose DB contract only accepts real
    // model identifiers. A renderer label here caused valid evidence turns to
    // fail at completion even though retrieval succeeded.
    model: String(input.model || 'gemini-3.5-flash'),
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { deterministic_message_list_render: 1, deterministic_provider_calls_avoided: 1 },
  }
}

const projection = (items: Array<Record<string, unknown>>) => {
  let enumerationItems: any[] | null = null
  let enumerationTotal: number | undefined
  let enumerationComplete: unknown
  const searchRows: any[] = []
  for (const item of items) {
    if (String(item.type || '') !== 'function_call_output') continue
    const payload: any = parse(item.output)
    const records = payload?.records
    if (payload?.tool === 'list_knowledge_catalog' && records && typeof records === 'object' && Array.isArray(records.items)) {
      enumerationItems = records.items
      enumerationTotal = Number(records.totalCount || records.items.length)
      enumerationComplete = records.complete
      continue
    }
    if (Array.isArray(records)) for (const record of records) searchRows.push(record)
  }
  const sourceRows = enumerationItems || searchRows
  const seen = new Set<string>()
  const compact = sourceRows.filter(record => {
    const key = String(record?.canonicalKey || record?.title || record?.name || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 100).map(record => ({
    canonicalKey: record.canonicalKey || '',
    objectType: record.objectType || '',
    title: record.title || record.name || '',
    ...(enumerationItems ? {} : { summary: record.summary || '' }),
  }))
  if (!compact.length) return null
  const payload = JSON.stringify({ totalCount: enumerationItems ? enumerationTotal : compact.length, complete: enumerationItems ? enumerationComplete : undefined, records: compact })
  return { role: 'user', content: `[JETWORK_EVIDENCE_INDEX]\n${payload.slice(0, 32000)}\n[END_JETWORK_EVIDENCE_INDEX]` }
}

const synthesisInstructions = (base: string) => [
  base,
  '[JETWORK FINAL EVIDENCE SYNTHESIS - REQUIRED]',
  'JETWORK_TOOL_EVIDENCE ve JETWORK_EVIDENCE_INDEX bu turda araçlardan dönen kurumsal kanıttır. Nihai yanıtı yalnız bu kanıtı esas alarak üret.',
  'Kanıtta bir exact identifier veya mesaj kaydı varsa onun bulunmadığını söylemek yasaktır.',
  'Kanıtta olmayan teknik kod, koşul, neden, ilişki veya çözüm üretme. Teknik ilişkiyi yalnız evidence index/summary açıkça söylüyorsa yaz.',
  'Önceki agent taslağını kanıt sayma; çelişki varsa kanıt kazanır.',
  'Liste sonucunda complete=true ise küme tamamdır. Kullanıcı mesajları/hataları/kayıtları soruyorsa complete listedeki kayıtları atlamadan ver; özetleyip bir kısmını gizleme. Kullanıcı açıkça özet istemişse özetleyebilirsin.',
].join('\n\n')

async function synthesize(input: any) {
  const baseItems = buildGeminiFinalSynthesisItems(input.items, '')
  const index = projection(input.items)
  return baseRequestGeminiResponse({
    ...input,
    instructions: synthesisInstructions(input.instructions),
    items: index ? [...baseItems, index] : baseItems,
    tools: [],
    allowTools: false,
  })
}

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  if (hasEvidence(input.items) && messageListQuestion(input.items)) {
    const rows = messageRows(input.items)
    if (rows.length) return deterministicMessageList(input, rows)
  }
  if (hasEvidence(input.items) && completeEnumeration(input.items)) return synthesize(input)
  if (!input.allowTools && hasEvidence(input.items)) return synthesize(input)
  if (input.allowTools && hasEvidence(input.items)) {
    let buffered = ''
    const first = await baseRequestGeminiResponse({ ...input, onText: (delta: string) => { buffered += delta } })
    if (!hasFunctionCalls(first) && responseText(first).trim()) return synthesize(input)
    return first
  }
  return baseRequestGeminiResponse(input)
}
