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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let body: ArrayBuffer
  let payload: Record<string, unknown>
  try {
    body = await req.arrayBuffer()
    const parsed = JSON.parse(new TextDecoder().decode(body))
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return jsonResponse({ error: 'Request body is invalid.' }, 400)
  }

  const message = clean(payload.message)
  const artifactRoute = requiresDocxArtifactRuntime(message)
  const target = artifactRoute ? 'openai-assistant-v2-internal' : 'openai-assistant-v2-primary'

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': artifactRoute ? 'jetwork-docx-artifact-route/v1' : 'jetwork-primary-route/v1',
      },
      body,
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
