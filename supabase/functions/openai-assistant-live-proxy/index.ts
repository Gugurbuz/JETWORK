import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { createSafeStreamSink } from '../_shared/safeStreamSink.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const streamHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-JetWork-Live-Progress': 'v1',
}

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const cleanString = (value: unknown, maxLength = 320) => String(value ?? '').trim().slice(0, maxLength)

const parseRequestBody = (body: ArrayBuffer): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const isActionToolInput = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Record<string, unknown>
  return cleanString(attachment.purpose, 40) === 'tool_input'
    && cleanString(attachment.storageBucket, 120) === 'assistant-files'
    && !!cleanString(attachment.storagePath, 1_000)
}

const attachmentOnlyActionResponse = (messageId: string) => new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      const sink = createSafeStreamSink(controller)
      sink.event('status', {
        type: 'status',
        stage: 'connecting',
        label: 'Dosyalar hazır',
      })
      sink.event('text_delta', {
        type: 'text_delta',
        delta: 'Dosyalar yüklendi. Ne yapmamı istediğini yaz.',
      })
      sink.event('sources', { type: 'sources', sources: [] })
      sink.event('completed', {
        type: 'completed',
        conversationId: messageId,
        model: 'system',
        fallbackUsed: false,
      })
      sink.done()
    },
  }),
  { headers: streamHeaders },
)

const edgeWaitUntil = (promise: Promise<unknown>) => {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
  }).EdgeRuntime
  runtime?.waitUntil?.(promise)
}

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : String(error || 'Unexpected assistant live progress error.')

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

  const parsedBody = parseRequestBody(body)
  const workspaceId = cleanString(parsedBody?.workspaceId, 200)
  const messageId = cleanString(parsedBody?.messageId, 240)
  const message = cleanString(parsedBody?.message, 32_000)

  if (workspaceId && messageId && !message) {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const { data, error } = await client
      .from('messages')
      .select('attachments')
      .eq('workspace_id', workspaceId)
      .eq('id', messageId)
      .maybeSingle()

    if (error) {
      console.warn('Attachment-only assistant turn could not be inspected:', error.message)
    } else {
      const attachments = Array.isArray(data?.attachments) ? data.attachments : []
      if (attachments.some(isActionToolInput)) {
        return attachmentOnlyActionResponse(messageId)
      }
    }
  }

  let downstreamCancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sink = createSafeStreamSink(controller)
      const timers: number[] = []
      const scheduleStatus = (delayMs: number, stage: string, label: string) => {
        timers.push(setTimeout(() => {
          if (!sink.isOpen()) return
          sink.event('status', { type: 'status', stage, label })
        }, delayMs))
      }
      const clearTimers = () => timers.forEach(timer => clearTimeout(timer))

      sink.event('status', {
        type: 'status',
        stage: 'connecting',
        label: 'Talep işleme alındı',
      })
      scheduleStatus(700, 'planning', 'Konuşma bağlamı hazırlanıyor...')
      scheduleStatus(4_000, 'planning', 'Talep türü ve çalışma yolu belirleniyor...')
      scheduleStatus(9_000, 'planning', 'Çalışma planı hazırlanıyor...')
      scheduleStatus(16_000, 'planning', 'Model için çalışma bağlamı hazırlanıyor...')

      const pump = (async () => {
        try {
          const upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-semantic-v2`, {
            method: 'POST',
            headers: {
              Authorization: authorization,
              apikey: anonKey,
              'Content-Type': req.headers.get('Content-Type') || 'application/json',
              'x-client-info': 'jetwork-live-progress-proxy/v1',
            },
            body,
          })
          clearTimers()

          if (!upstream.ok) {
            const payload = await upstream.json().catch(() => ({})) as Record<string, unknown>
            const message = String(payload.error || `Asistan servisi ${upstream.status} hatası döndürdü.`)
            if (sink.isOpen()) {
              sink.event('error', { type: 'error', message })
              sink.done()
            }
            return
          }

          if (!upstream.body) {
            if (sink.isOpen()) {
              sink.event('error', { type: 'error', message: 'Asistan servisi boş yanıt döndürdü.' })
              sink.done()
            }
            return
          }

          const reader = upstream.body.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) sink.write(value)
            }
          } finally {
            try { reader.releaseLock() } catch { /* already released */ }
          }
        } catch (error) {
          console.error('Live progress proxy upstream failed:', errorMessage(error))
          if (sink.isOpen()) {
            sink.event('error', {
              type: 'error',
              message: 'Asistan çalışma akışı tamamlanamadı. Lütfen tekrar deneyin.',
            })
            sink.done()
          }
        } finally {
          clearTimers()
          if (!downstreamCancelled) sink.close()
        }
      })()

      edgeWaitUntil(pump)
    },
    cancel(reason) {
      downstreamCancelled = true
      console.info('Live progress downstream cancelled:', String(reason || 'client disconnected'))
    },
  })

  return new Response(stream, { headers: streamHeaders })
})
