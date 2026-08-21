import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const streamHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-JetWork-Primary-Agent-Bridge': 'v1',
};

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405);

  const authorization = req.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Authentication is required.' }, 401);
  }

  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return jsonResponse({ error: 'Request body could not be read.' }, 400);
  }

  try {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': req.headers.get('Content-Type') || 'application/json',
        'x-client-info': 'jetwork-primary-agent-bridge/v1',
      },
      body,
    });

    if (!upstream.ok || !upstream.body) {
      const responseBody = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0));
      return new Response(responseBody, {
        status: upstream.status || 502,
        headers: {
          ...corsHeaders,
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'X-JetWork-Primary-Agent-Bridge': 'v1',
        },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: streamHeaders,
    });
  } catch (error) {
    console.error('Primary-agent bridge could not reach openai-assistant:', error);
    return jsonResponse({
      error: 'Asistan servisine bağlanılamadı. Lütfen tekrar deneyin.',
      code: 'PRIMARY_AGENT_UNREACHABLE',
    }, 502);
  }
});
