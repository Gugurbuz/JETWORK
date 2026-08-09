import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createSafeStreamSink } from '../_shared/safeStreamSink.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'X-JetWork-Stream-Gateway': 'v1',
  },
})

const gatewayHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-JetWork-Stream-Gateway': 'v1',
}

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : 'Unexpected stream gateway error.'

const safeLatencyMessageId = (body: ArrayBuffer): string => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body))
    return String(parsed?.messageId || '').trim().slice(0, 200)
  } catch {
    return ''
  }
}

const logLatency = (event: string, payload: Record<string, unknown>) => {
  // Operational timing metadata only: never log prompts, response text, tokens,
  // credentials or user profile fields here.
  console.info(event, JSON.stringify(payload))
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const gatewayReceivedAtMs = Date.now()
  const traceId = crypto.randomUUID()
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
  const bodyReadAtMs = Date.now()
  const messageId = safeLatencyMessageId(body)

  let upstream: Response
  const upstreamStartedAtMs = Date.now()
  try {
    // Deliberately do NOT attach req.signal here. The core turn is the durable
    // business operation; a browser navigation must not cancel it halfway and
    // leave the conversation lease or reasoning ledger in a false error state.
    upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-core-v2`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': req.headers.get('Content-Type') || 'application/json',
        'x-client-info': req.headers.get('x-client-info') || 'jetwork-stream-gateway/v1',
      },
      body,
    })
  } catch (error) {
    const upstreamFailedAtMs = Date.now()
    logLatency('ASSISTANT_GATEWAY_LATENCY', {
      traceId,
      messageId,
      outcome: 'core_unreachable',
      gatewayReceivedAtMs,
      bodyReadAtMs,
      upstreamStartedAtMs,
      upstreamFailedAtMs,
      bodyReadMs: bodyReadAtMs - gatewayReceivedAtMs,
      coreConnectionMs: upstreamFailedAtMs - upstreamStartedAtMs,
    })
    console.error('Assistant stream gateway could not reach reasoning core:', errorMessage(error))
    return jsonResponse({
      error: 'Asistan reasoning servisine bağlanılamadı. Lütfen tekrar deneyin.',
      code: 'REASONING_CORE_UNREACHABLE',
    }, 502)
  }

  const coreHeadersAtMs = Date.now()
  logLatency('ASSISTANT_GATEWAY_LATENCY', {
    traceId,
    messageId,
    outcome: upstream.ok ? 'core_headers_ready' : 'core_error_headers_ready',
    status: upstream.status,
    gatewayReceivedAtMs,
    bodyReadAtMs,
    upstreamStartedAtMs,
    coreHeadersAtMs,
    bodyReadMs: bodyReadAtMs - gatewayReceivedAtMs,
    gatewayQueueMs: upstreamStartedAtMs - bodyReadAtMs,
    coreHeadersMs: coreHeadersAtMs - upstreamStartedAtMs,
    gatewayToCoreHeadersMs: coreHeadersAtMs - gatewayReceivedAtMs,
  })

  if (!upstream.ok || !upstream.body) {
    const responseBody = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0))
    return new Response(responseBody, {
      status: upstream.status || 502,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'X-JetWork-Stream-Gateway': 'v1',
      },
    })
  }

  const reader = upstream.body.getReader()
  let downstreamCancelled = false
  let pumpPromise: Promise<void> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sink = createSafeStreamSink(controller)

      pumpPromise = (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) sink.write(value)
          }
        } catch (error) {
          console.error('Assistant stream gateway upstream read failed:', errorMessage(error))
          if (sink.isOpen()) {
            sink.event('error', {
              type: 'error',
              message: 'Asistan yanıt akışı tamamlanamadı. Lütfen tekrar deneyin.',
            })
            sink.done()
          }
        } finally {
          const streamCompletedAtMs = Date.now()
          logLatency('ASSISTANT_GATEWAY_LATENCY_COMPLETE', {
            traceId,
            messageId,
            downstreamCancelled,
            gatewayReceivedAtMs,
            coreHeadersAtMs,
            streamCompletedAtMs,
            coreStreamMs: streamCompletedAtMs - coreHeadersAtMs,
            gatewayTotalMs: streamCompletedAtMs - gatewayReceivedAtMs,
          })
          sink.close()
          try { reader.releaseLock() } catch { /* already released/cancelled */ }
          if (downstreamCancelled) {
            console.info('Assistant downstream disconnected; reasoning core consumption completed safely.')
          }
        }
      })()

      // Supabase Edge Runtime keeps the upstream pump alive even when the
      // browser disconnects from the response stream.
      const edgeRuntime = (globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
      }).EdgeRuntime
      edgeRuntime?.waitUntil?.(pumpPromise)
    },

    cancel(reason) {
      downstreamCancelled = true
      // Intentionally do not call reader.cancel() and do not abort the upstream
      // fetch. SafeStreamSink will make all later downstream writes no-ops.
      console.info('Assistant downstream stream cancelled:', String(reason || 'client disconnected'))
    },
  })

  return new Response(stream, { headers: gatewayHeaders })
})
