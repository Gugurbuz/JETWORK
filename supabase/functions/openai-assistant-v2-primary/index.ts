import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

// Compatibility shim for the production primary-agent bridge. The bridge already
// marks routed requests with autoRouted=true, but the legacy core only receives
// the concrete Gemini model. Attach a signed, reserved marker to the forwarded
// current-turn text so the provider compatibility layer can distinguish a real
// Auto-routed Pro request from an explicitly selected Pro request.
const nativeFetch = globalThis.fetch.bind(globalThis)
const encoder = new TextEncoder()
const AUTO_ROUTE_MARKER_VERSION = '1'
const PRIMARY_BRIDGE_URL = 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/e687e4c0c335e92ead22f0ce94f817e3cf2ad635/supabase/functions/openai-assistant-v2-primary-bridge-evidence/index.ts?noisy-current-turn-v8=1'

const clean = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)
const bytesToHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

async function signedAutoRouteMarker(payload: Record<string, unknown>) {
  if (payload.autoRouted !== true) return ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) return ''

  const workspaceId = clean(payload.workspaceId, 200)
  const messageId = clean(payload.messageId, 240)
  const model = clean(payload.model, 120)
  if (!workspaceId || !messageId || !model) return ''

  const material = `jetwork-auto-route-v${AUTO_ROUTE_MARKER_VERSION}|${workspaceId}|${messageId}|${model}`
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(serviceRoleKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(material)))
  return `[JETWORK_AUTO_ROUTE_ORIGIN v=${AUTO_ROUTE_MARKER_VERSION} model=${model} workspace=${workspaceId} message=${messageId} sig=${signature}]`
}

const interceptedFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url

  if (url.includes('/functions/v1/openai-assistant') && typeof init?.body === 'string') {
    try {
      const parsed = JSON.parse(init.body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const payload = parsed as Record<string, unknown>
        const marker = await signedAutoRouteMarker(payload)
        if (marker) {
          const message = String(payload.message ?? '')
          payload.message = message ? `${message}\n\n${marker}` : marker
          init = { ...init, body: JSON.stringify(payload) }
        }
      }
    } catch (error) {
      console.warn('AUTO_ROUTE_PROVENANCE_MARKER_SKIPPED', String(error).slice(0, 300))
    }
  }

  return nativeFetch(input, init)
}

globalThis.fetch = interceptedFetch

await import(PRIMARY_BRIDGE_URL)
