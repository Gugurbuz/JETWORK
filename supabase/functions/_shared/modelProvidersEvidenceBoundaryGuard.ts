import {
  requestGeminiResponse as boundaryRequest,
  type NormalizedModelResponse,
} from './modelProvidersEvidenceBoundaryV2.ts'

export * from './modelProvidersEvidenceBoundaryV2.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const responseText = (response: NormalizedModelResponse) => (response.output || [])
  .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
  .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
  .map((part: any) => part.text)
  .join('')

const lastUserText = (items: Array<Record<string, unknown>>) => {
  for (let index = (items || []).length - 1; index >= 0; index -= 1) {
    const item: any = items[index]
    if (String(item?.role || '') !== 'user') continue
    if (typeof item.content === 'string') return item.content
    if (Array.isArray(item.content)) return item.content.map((part: any) => part?.text || '').join('\n')
  }
  return ''
}

const explicitlyRequestsSyntheticExample = (items: Array<Record<string, unknown>>) =>
  /(?:örnek|taslak|hipotetik|temsili|varsay(?:ım|ımsal)?|uydur(?:ulmuş)?|sample|example|mock|hypothetical)/iu.test(lastUserText(items))

const boundaryPayloads = (items: Array<Record<string, unknown>>) => (items || []).flatMap((item: any) => {
  if (String(item?.type || '') !== 'function_call_output') return []
  const payload: any = parse(item.output)
  return payload?.evidenceBoundary === 'metadata_only' ? [payload] : []
})

const speculativeBoundaryOutput = (text: string) => {
  if (!text.trim()) return false
  return /```/u.test(text)
    || /\b(?:örnek|taslak|tahmin(?:i|en)?|muhtemel(?:en)?|olası|varsay(?:ım|ımsal)?|hipotetik|temsili)\b/iu.test(text)
    || /\b(?:example|sample|hypothetical|likely|probably|possibly)\b/iu.test(text)
}

const canonicalLeaf = (key: string) => {
  const body = String(key || '').split(':').slice(1).join(':')
  return (body.split('/').pop() || body).toUpperCase()
}

const safeBoundaryText = (items: Array<Record<string, unknown>>, payloads: any[]) => {
  const requested = payloads.map(payload => String(payload?.canonicalKey || '')).filter(Boolean)
  const technicalReference = payloads.map(payload => String(payload?.technicalReference || '')).find(Boolean) || ''
  const targetLeaf = technicalReference.toUpperCase() || canonicalLeaf(requested[0] || '')
  const records = payloads.flatMap(payload => Array.isArray(payload?.records) ? payload.records : [])
  const candidates = [...new Set(records
    .map((record: any) => String(record?.canonicalKey || ''))
    .filter(Boolean)
    .filter(key => !targetLeaf || canonicalLeaf(key) === targetLeaf))]
    .slice(0, 6)
  const identities = candidates.length
    ? `\n\nDoğrulanabilen teknik kimlik adayları: ${candidates.map(key => `\`${key}\``).join(', ')}.`
    : ''
  return `İstenen implementasyon detayı doğrulanmış kurumsal kaynaklarda mevcut değil. Bu nedenle kaynakta bulunmayan ABAP kodu, SELECT ifadesi, parametre/DDIC tipi, dönüş tipi veya algoritma üretmeyeceğim.${identities}`
}

const replaceResponseText = (response: NormalizedModelResponse, text: string): NormalizedModelResponse => ({
  ...response,
  output: [{
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  }],
  usage: {
    ...(response.usage || {}),
    evidence_boundary_output_guard: 1,
  },
})

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const payloads = boundaryPayloads(input.items || [])
  if (!payloads.length || explicitlyRequestsSyntheticExample(input.items || [])) {
    return boundaryRequest(input)
  }

  let streamed = ''
  const response = await boundaryRequest({
    ...input,
    onText: (delta: string) => { streamed += delta },
  })
  const text = responseText(response) || streamed
  if (!speculativeBoundaryOutput(text)) {
    if (text) input.onText(text)
    return response
  }

  const safe = safeBoundaryText(input.items || [], payloads)
  input.onText(safe)
  return replaceResponseText(response, safe)
}
