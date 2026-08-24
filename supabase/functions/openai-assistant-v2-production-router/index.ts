import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-jetwork-runtime-route',
}
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})
const encoder = new TextEncoder()
const AUTO_ORIGIN_PROOF_VERSION = '1'
const AUTO_ORIGIN_PROOF_FIELD = 'jetworkAutoOriginProof'
const clean = (value: unknown, max = 32_000) => String(value ?? '').trim().slice(0, max)
const normalize = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
const requiresDocxArtifactRuntime = (message: string) => {
  const text = normalize(message)
  const wordFormat = /(?:^|\W)(?:docx|\.docx|word)(?:$|\W)/u.test(text)
  if (!wordFormat) return false
  return /\b(?:dosya|dokuman|belge|rapor|analiz|hazirla|olustur|uret|yaz|ver|indir|export|format|olarak)\b/u.test(text)
}
const bytesToHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)]
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('')

async function signAutoOrigin(payload: Record<string, unknown>) {
  if (clean(payload.model, 80) !== 'auto') return ''
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!secret) return ''
  const workspaceId = clean(payload.workspaceId, 200)
  const messageId = clean(payload.messageId, 240)
  if (!workspaceId || !messageId) return ''

  const material = `jetwork-auto-origin-v${AUTO_ORIGIN_PROOF_VERSION}|${workspaceId}|${messageId}|auto`
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(material)))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)
  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let payload: Record<string, unknown>
  try {
    const parsed = await req.json()
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return jsonResponse({ error: 'Request body is invalid.' }, 400)
  }

  const artifactRoute = requiresDocxArtifactRuntime(clean(payload.message))
  const target = artifactRoute ? 'openai-assistant-v2-internal' : 'openai-assistant-v2-primary'
  if (!artifactRoute) {
    const proof = await signAutoOrigin(payload)
    if (proof) payload[AUTO_ORIGIN_PROOF_FIELD] = proof
  }

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': artifactRoute ? 'jetwork-docx-artifact-route/v1' : 'jetwork-primary-route/v2',
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return jsonResponse({ error: 'Assistant runtime could not be reached.', code: 'ASSISTANT_RUNTIME_UNREACHABLE' }, 502)
  }
  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'x-jetwork-runtime-route')
  headers.set('x-jetwork-runtime-route', artifactRoute ? 'docx-reasoning-v2' : 'primary-agent')
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
})
