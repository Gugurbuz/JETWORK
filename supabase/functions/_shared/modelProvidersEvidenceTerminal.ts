import {
  requestGeminiResponse as upstreamRequest,
  type NormalizedModelResponse,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/206a58fa20f0583344b1a09ac9c9de5edb86ab62/supabase/functions/_shared/modelProvidersMaxItemsLock.ts'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/206a58fa20f0583344b1a09ac9c9de5edb86ab62/supabase/functions/_shared/modelProvidersMaxItemsLock.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const metadataOnlyEvidence = (items: Array<Record<string, unknown>>) => (items || []).flatMap((item: any) => {
  if (String(item?.type || '') !== 'function_call_output') return []
  const payload: any = parse(item.output)
  if (!payload || payload.evidenceBoundary !== 'metadata_only') return []
  return [payload]
})

const canonicalLeaf = (key: unknown) => {
  const body = String(key || '').split(':').slice(1).join(':')
  return body.split('/').pop() || body
}

const terminalText = (payloads: any[]) => {
  const technicalReference = payloads
    .map(payload => String(payload?.technicalReference || '').trim())
    .find(Boolean)
  const canonicalKey = payloads
    .map(payload => String(payload?.canonicalKey || '').trim())
    .find(Boolean)
  const identity = technicalReference || canonicalLeaf(canonicalKey) || ''

  return identity
    ? `\`${identity}\` için teknik kimlik doğrulanıyor; ancak istediğin implementasyon detayı mevcut doğrulanmış kurumsal kaynaklarda yer almıyor. Kaynakta olmayan tablo, alan, kod, koşul veya algoritma ayrıntısı üretmeyeceğim.`
    : 'İstenen implementasyon detayı mevcut doğrulanmış kurumsal kaynaklarda yer almıyor. Kaynakta olmayan tablo, alan, kod, koşul veya algoritma ayrıntısı üretmeyeceğim.'
}

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const payloads = metadataOnlyEvidence(input.items || [])

  // metadata_only is an explicit evidence contract: the requested technical object
  // identity is known, but implementation evidence is not materialized. A further
  // provider round cannot create trustworthy evidence, so terminate generically
  // instead of paying for another synthesis that may speculate.
  if (payloads.length && input.allowTools) {
    const text = terminalText(payloads)
    input.onText(text)
    return {
      id: `jetwork-metadata-only-terminal:${crypto.randomUUID()}`,
      status: 'completed',
      model: String(input.model || 'gemini-3.5-flash'),
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      }],
      usage: {
        evidence_boundary_metadata_only_terminal: 1,
        deterministic_provider_calls_avoided: 1,
      },
    } as NormalizedModelResponse
  }

  return upstreamRequest(input)
}
