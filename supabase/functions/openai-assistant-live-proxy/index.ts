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
  'X-JetWork-Live-Progress': 'v3',
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
        activityKind: 'artifact',
        activityState: 'completed',
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

const activityKindForStage = (stage: string) => {
  if (stage === 'searching_knowledge') return 'knowledge'
  if (stage === 'searching_web') return 'web'
  if (stage === 'verifying') return 'reasoning'
  if (stage === 'answering') return 'response'
  if (stage === 'synthesizing') return 'reasoning'
  return 'reasoning'
}

const completedLabel = (value: string) => /(?:hazırlandı|oluşturuldu|belirlendi|değerlendirildi|toplandı|bulundu|tamamlandı|doğrulandı|engellendi|hazır)$/iu.test(value)

const friendlyRuntimeLabel = (stage: string, rawLabel: string) => {
  const label = cleanString(rawLabel, 500)
  if (!label) return label
  if (/^Talep sınıflandırıldı:/iu.test(label)) return 'Talebin kapsamı değerlendirildi'
  if (/^Kısa yanıt yolu hazırlanıyor/iu.test(label)) return 'Çalışma planı hazırlanıyor...'
  if (/^Araştırma ve doğrulama planı oluşturuluyor/iu.test(label)) return 'Araştırma ve doğrulama planı hazırlanıyor...'
  if (/^Kanıtlar ve doğrulama sonucu sentezleniyor/iu.test(label)) return 'Bulunan bilgiler birleştiriliyor...'
  if (/^Sentez sırasında ek teknik kanıt isteniyor/iu.test(label)) return 'Ek teknik kaynak aranıyor...'
  if (/^İlgili JetWork skill prosedürleri yükleniyor/iu.test(label)) return 'Gerekli JetWork yetenekleri hazırlanıyor...'
  if (/^Kanıt yeterliliği ve çelişkiler kontrol ediliyor/iu.test(label)) return 'Kaynakların yeterliliği ve tutarlılığı kontrol ediliyor...'
  if (/^Doğrulama tamamlandı:/iu.test(label)) return 'Kaynak doğrulaması tamamlandı'
  if (/^Yanıt hazırlandı$/iu.test(label)) return 'Yanıt oluşturuldu'
  if (/^(\d+) kurumsal kaynak izi toplandı$/iu.test(label)) {
    const count = label.match(/^(\d+)/u)?.[1]
    return `${count || ''} ilgili kurumsal kaynak bulundu`.trim()
  }
  if (/^(\d+) web kaynağı toplandı$/iu.test(label)) {
    const count = label.match(/^(\d+)/u)?.[1]
    return `${count || ''} ilgili web kaynağı bulundu`.trim()
  }
  if (/^OpenAI sağlayıcısı başarısız oldu;/iu.test(label)) return 'Yanıt üretimi için yedek model devreye alınıyor...'
  if (stage === 'routing') return 'Talebin kapsamı değerlendiriliyor...'
  return label
}

const loadConversationContextCount = async (
  client: ReturnType<typeof createClient>,
  workspaceId: string,
  messageId: string,
) => {
  if (!workspaceId) return 0
  const { data, error } = await client
    .from('messages')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'model'])
    .neq('id', messageId)
    .order('created_at', { ascending: false })
    .limit(12)
  if (error) throw error
  return Array.isArray(data) ? data.length : 0
}

const loadReasoningPlanLabels = async (
  client: ReturnType<typeof createClient>,
  workspaceId: string,
  messageId: string,
): Promise<string[]> => {
  if (!workspaceId || !messageId) return []
  const { data: turn, error: turnError } = await client
    .from('assistant_turns')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('message_id', messageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (turnError || !turn?.id) return []

  const { data: run, error: runError } = await client
    .from('assistant_reasoning_runs')
    .select('plan')
    .eq('workspace_id', workspaceId)
    .eq('turn_id', turn.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (runError || !run?.plan || typeof run.plan !== 'object') return []
  const steps = Array.isArray((run.plan as Record<string, unknown>).steps)
    ? (run.plan as Record<string, unknown>).steps as Array<Record<string, unknown>>
    : []
  return steps
    .map(step => cleanString(step?.label, 140))
    .filter(Boolean)
    .slice(0, 4)
}

const rewriteStatusFrame = async (input: {
  frame: string
  client: ReturnType<typeof createClient>
  workspaceId: string
  messageId: string
}) => {
  const eventLine = input.frame.split(/\r?\n/u).find(line => line.startsWith('event:'))
  const dataLines = input.frame.split(/\r?\n/u)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
  if (!dataLines.length) return input.frame
  const dataText = dataLines.join('\n')
  if (dataText === '[DONE]') return input.frame

  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(dataText)
    if (!parsed || typeof parsed !== 'object') return input.frame
    payload = parsed as Record<string, unknown>
  } catch {
    return input.frame
  }

  const eventName = cleanString(eventLine?.slice(6), 40)
  if (eventName !== 'status' && payload.type !== 'status') return input.frame

  const stage = cleanString(payload.stage, 80) || 'thinking'
  const originalLabel = cleanString(payload.label, 500)
  let label = friendlyRuntimeLabel(stage, originalLabel)

  if (/^Plan hazır(?::|$)/iu.test(originalLabel)) {
    const planLabels = await loadReasoningPlanLabels(input.client, input.workspaceId, input.messageId).catch(() => [])
    label = planLabels.length
      ? `Plan: ${planLabels.join(' → ')}`
      : 'Çalışma planı oluşturuldu'
  }

  payload = {
    ...payload,
    type: 'status',
    stage,
    label,
    activityKind: activityKindForStage(stage),
    activityState: completedLabel(label) || /^Plan:/u.test(label) ? 'completed' : 'active',
  }
  return `event: status\ndata: ${JSON.stringify(payload)}`
}

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

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  if (workspaceId && messageId && !message) {
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
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()

      sink.event('status', {
        type: 'status',
        stage: 'connecting',
        label: 'Talep işleme alındı',
        activityKind: 'request',
        activityState: 'completed',
      })

      const pump = (async () => {
        try {
          sink.event('status', {
            type: 'status',
            stage: 'thinking',
            label: 'Önceki konuşma bağlamı hatırlanıyor...',
            activityKind: 'memory',
            activityState: 'active',
          })
          try {
            const contextCount = await loadConversationContextCount(client, workspaceId, messageId)
            sink.event('status', {
              type: 'status',
              stage: 'thinking',
              label: contextCount > 0 ? 'Önceki konuşma bağlamı incelendi' : 'Önceki konuşma bağlamı kontrol edildi',
              activityKind: 'memory',
              activityState: 'completed',
            })
          } catch (contextError) {
            console.warn('Live progress context inspection failed:', errorMessage(contextError))
            sink.event('status', {
              type: 'status',
              stage: 'thinking',
              label: 'Konuşma bağlamı kontrol edildi',
              activityKind: 'memory',
              activityState: 'completed',
            })
          }

          sink.event('status', {
            type: 'status',
            stage: 'planning',
            label: 'Talebin kapsamı ve çalışma yolu değerlendiriliyor...',
            activityKind: 'reasoning',
            activityState: 'active',
          })

          const upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-semantic-v2`, {
            method: 'POST',
            headers: {
              Authorization: authorization,
              apikey: anonKey,
              'Content-Type': req.headers.get('Content-Type') || 'application/json',
              'x-client-info': 'jetwork-live-progress-proxy/v3',
            },
            body,
          })

          if (!upstream.ok) {
            const payload = await upstream.json().catch(() => ({})) as Record<string, unknown>
            const upstreamMessage = String(payload.error || `Asistan servisi ${upstream.status} hatası döndürdü.`)
            if (sink.isOpen()) {
              sink.event('error', { type: 'error', message: upstreamMessage })
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

          sink.event('status', {
            type: 'status',
            stage: 'planning',
            label: 'Çalışma yaklaşımı belirlendi',
            activityKind: 'reasoning',
            activityState: 'completed',
          })

          const reader = upstream.body.getReader()
          let buffer = ''
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (!value) continue
              buffer += decoder.decode(value, { stream: true })
              const frames = buffer.split(/\r?\n\r?\n/u)
              buffer = frames.pop() || ''
              for (const frame of frames) {
                if (!frame.trim()) continue
                const rewritten = await rewriteStatusFrame({ frame, client, workspaceId, messageId })
                sink.write(encoder.encode(`${rewritten}\n\n`))
              }
            }
            buffer += decoder.decode()
            if (buffer.trim()) {
              const rewritten = await rewriteStatusFrame({ frame: buffer, client, workspaceId, messageId })
              sink.write(encoder.encode(`${rewritten}\n\n`))
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