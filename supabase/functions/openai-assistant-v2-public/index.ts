import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { filterUserFacingAssistantSse } from '../_shared/userFacingAssistantSse.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}
const streamHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-JetWork-Presentation-Gateway': 'status-private-v1',
}
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Authentication is required.' }, 401)
  }

  let body: ArrayBuffer
  try {
    body = await req.arrayBuffer()
  } catch {
    return jsonResponse({ error: 'Request body could not be read.' }, 400)
  }

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-v2-internal`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': req.headers.get('Content-Type') || 'application/json',
        'x-client-info': 'jetwork-public-assistant-presentation/status-private-v1',
      },
      body,
    })
  } catch (error) {
    console.error('Public assistant presentation proxy could not reach internal gateway:', error)
    return jsonResponse({
      error: 'Asistan servisine bağlanılamadı. Lütfen tekrar deneyin.',
      code: 'ASSISTANT_INTERNAL_GATEWAY_UNREACHABLE',
    }, 502)
  }

  if (!upstream.ok || !upstream.body) {
    const responseBody = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0))
    return new Response(responseBody, {
      status: upstream.status || 502,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'X-JetWork-Presentation-Gateway': 'status-private-v1',
      },
    })
  }

  return new Response(filterUserFacingAssistantSse(upstream.body), {
    status: upstream.status,
    headers: streamHeaders,
  })
})
