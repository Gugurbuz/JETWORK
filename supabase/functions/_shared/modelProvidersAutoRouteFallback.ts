import {
  requestGeminiResponse as baseRequestGeminiResponse,
  type NormalizedModelResponse,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/ce956bd544a10869e15897eb73691b598d3ed974/supabase/functions/_shared/modelProvidersAuthoritativeTerminal.ts?auto-route-fallback-base=1'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/ce956bd544a10869e15897eb73691b598d3ed974/supabase/functions/_shared/modelProvidersAuthoritativeTerminal.ts?auto-route-fallback-base=1'

const PRO_MODEL = 'gemini-3.1-pro-preview'
const FLASH_MODEL = 'gemini-3.5-flash'
const AUTO_ROUTE_MARKER_VERSION = '1'
const AUTO_ROUTE_MARKER = /\[JETWORK_AUTO_ROUTE_ORIGIN v=1 model=([^\s\]]+) workspace=([^\s\]]+) message=([^\s\]]+) sig=([a-f0-9]{64})\]/gu
const encoder = new TextEncoder()

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

type AutoRouteProof = {
  model: string
  workspaceId: string
  messageId: string
  signature: string
}

const errorText = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>
    return String(candidate.message || candidate.status || candidate.code || '')
  }
  return String(error || '')
}

const isTransientProviderFailure = (error: unknown) => (
  /GEMINI_PRO_UNAVAILABLE|provider attempt timed out|TimeoutError|408|429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|temporar|network/i
    .test(errorText(error))
)

const contentTexts = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.flatMap(part => {
    if (typeof part === 'string') return [part]
    if (!part || typeof part !== 'object') return []
    const record = part as Record<string, unknown>
    return typeof record.text === 'string' ? [record.text] : []
  })
}

const markerProofs = (items: Array<Record<string, unknown>>): AutoRouteProof[] => {
  const proofs: AutoRouteProof[] = []
  for (const item of items) {
    for (const text of contentTexts(item.content)) {
      for (const match of text.matchAll(AUTO_ROUTE_MARKER)) {
        proofs.push({
          model: String(match[1] || ''),
          workspaceId: String(match[2] || ''),
          messageId: String(match[3] || ''),
          signature: String(match[4] || ''),
        })
      }
    }
  }
  return proofs
}

const stripMarkerText = (value: string) => value
  .replace(AUTO_ROUTE_MARKER, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const stripReservedMarkers = (items: Array<Record<string, unknown>>) => items.map(item => {
  const clean = { ...item }
  if (typeof clean.content === 'string') {
    clean.content = stripMarkerText(clean.content)
  } else if (Array.isArray(clean.content)) {
    clean.content = clean.content.map(part => {
      if (typeof part === 'string') return stripMarkerText(part)
      if (!part || typeof part !== 'object') return part
      const record = { ...(part as Record<string, unknown>) }
      if (typeof record.text === 'string') record.text = stripMarkerText(record.text)
      return record
    })
  }
  return clean
})

const hexBytes = (value: string) => {
  if (!/^[a-f0-9]{64}$/i.test(value)) return new Uint8Array()
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

async function hasValidAutoRouteProof(items: Array<Record<string, unknown>>, requestedModel: string) {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) return false
  const proofs = markerProofs(items).filter(proof => proof.model === requestedModel)
  if (!proofs.length) return false

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(serviceRoleKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  for (const proof of proofs) {
    const material = `jetwork-auto-route-v${AUTO_ROUTE_MARKER_VERSION}|${proof.workspaceId}|${proof.messageId}|${proof.model}`
    const signature = hexBytes(proof.signature)
    if (!signature.length) continue
    if (await crypto.subtle.verify('HMAC', key, signature, encoder.encode(material))) return true
  }
  return false
}

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

export async function requestGeminiResponse(input: GeminiRequest): Promise<NormalizedModelResponse> {
  const autoRouted = await hasValidAutoRouteProof(input.items, input.model)
  const cleanItems = stripReservedMarkers(input.items)

  if (!autoRouted || input.model !== PRO_MODEL) {
    return baseRequestGeminiResponse({ ...input, items: cleanItems })
  }

  const callBuffered = async (model: string) => {
    let text = ''
    const response = await baseRequestGeminiResponse({
      ...input,
      model,
      items: cleanItems,
      onText: delta => { text += delta },
    })
    return { response, text }
  }

  try {
    const primary = await callBuffered(PRO_MODEL)
    if (primary.text) input.onText(primary.text)
    return primary.response
  } catch (error) {
    if (input.signal?.aborted || !isTransientProviderFailure(error)) throw error

    console.warn('AUTO_ROUTED_GEMINI_PRO_RECOVERY_TO_FLASH', {
      fromModel: PRO_MODEL,
      toModel: FLASH_MODEL,
      error: errorText(error).slice(0, 500),
    })

    const fallback = await callBuffered(FLASH_MODEL)
    if (fallback.text) input.onText(fallback.text)
    return mergeUsage(fallback.response, {
      auto_routed_gemini_pro_transient_failure: 1,
      auto_routed_gemini_pro_fallback_flash: 1,
    })
  }
}
