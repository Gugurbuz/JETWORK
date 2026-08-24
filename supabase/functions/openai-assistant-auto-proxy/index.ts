import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const encoder = new TextEncoder()
const AUTO_ROUTE_MARKER_VERSION = '1'
const CORE_SLUG = 'openai-assistant-legacy-core-autofallback'
const clean = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)
const bytesToHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)]
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('')

async function signedAutoRouteMarker(payload: Record<string, unknown>) {
  if (payload.autoRouted !== true) return ''
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!secret) return ''

  const workspaceId = clean(payload.workspaceId, 200)
  const messageId = clean(payload.messageId, 240)
  const model = clean(payload.model, 120)
  if (!workspaceId || !messageId || !model) return ''

  const material = `jetwork-auto-route-v${AUTO_ROUTE_MARKER_VERSION}|${workspaceId}|${messageId}|${model}`
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(material)))
  return `[JETWORK_AUTO_ROUTE_ORIGIN v=${AUTO_ROUTE_MARKER_VERSION} model=${model} workspace=${workspaceId} message=${messageId} sig=${signature}]`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Authentication is required.' }, 401)
  }

  let payload: Record<string, unknown>
  try {
    const parsed = await req.json()
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return jsonResponse({ error: 'Request body is invalid.' }, 400)
  }

  try {
    const marker = await signedAutoRouteMarker(payload)
    if (marker) {
      const message = String(payload.message ?? '')
      payload.message = message ? `${message}\n\n${marker}` : marker
    }

    const upstream = await fetch(`${supabaseUrl}/functions/v1/${CORE_SLUG}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': marker ? 'jetwork-auto-provenance-proxy/v1' : 'jetwork-assistant-proxy/v1',
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    })

    const headers = new Headers(upstream.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  } catch (error) {
    console.error('ASSISTANT_AUTO_PROXY_FAILED', error instanceof Error ? error.message : String(error))
    return jsonResponse({
      error: 'Asistan core servisine bağlanılamadı.',
      code: 'ASSISTANT_CORE_UNREACHABLE',
    }, 502)
  }
})
