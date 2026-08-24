import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  applyEnerjisaAnalysisDocxProfile,
  classifyDocumentArtifactRequest,
} from '../_shared/documentArtifactRouting.ts'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let payload: Record<string, unknown>
  try {
    const rawBody = await req.arrayBuffer()
    const parsed = JSON.parse(new TextDecoder().decode(rawBody))
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return jsonResponse({ error: 'Request body is invalid.' }, 400)
  }

  const message = clean(payload.message, 26_000)
  const routeDecision = classifyDocumentArtifactRequest(message)
  const artifactRoute = routeDecision.artifactRoute
  const target = artifactRoute ? 'openai-assistant-v2-internal' : 'openai-assistant-v2-primary'
  const routedPayload = routeDecision.enerjisaAnalysisDocx
    ? { ...payload, message: applyEnerjisaAnalysisDocxProfile(message, routeDecision) }
    : payload
  const upstreamBody = new TextEncoder().encode(JSON.stringify(routedPayload))

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': routeDecision.enerjisaAnalysisDocx
          ? 'jetwork-enerjisa-analysis-docx-route/v1'
          : artifactRoute
            ? 'jetwork-docx-artifact-route/v1'
            : 'jetwork-primary-route/v1',
      },
      body: upstreamBody,
    })
  } catch {
    return jsonResponse({ error: 'Assistant runtime could not be reached.', code: 'ASSISTANT_RUNTIME_UNREACHABLE' }, 502)
  }

  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'x-jetwork-runtime-route')
  headers.set('x-jetwork-runtime-route', routeDecision.enerjisaAnalysisDocx
    ? 'enerjisa-analysis-docx-v1'
    : artifactRoute
      ? 'docx-reasoning-v2'
      : 'primary-agent')
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
})
