import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-jetwork-artifact-runtime',
}
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let body: ArrayBuffer
  try { body = await req.arrayBuffer() }
  catch { return jsonResponse({ error: 'Request body could not be read.' }, 400) }

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-v2-internal`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': 'jetwork-explicit-artifact-v1',
      },
      body,
    })
  } catch {
    return jsonResponse({ error: 'Artifact reasoning runtime could not be reached.', code: 'ARTIFACT_RUNTIME_UNREACHABLE' }, 502)
  }

  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'x-jetwork-artifact-runtime')
  headers.set('x-jetwork-artifact-runtime', 'reasoning-v2')
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
})
