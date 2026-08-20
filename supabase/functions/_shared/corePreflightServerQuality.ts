import { serve as telemetryServe } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/ttftTelemetryServer.ts?jetwork-core-preflight-final=4'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createJetWorkPresentationDeltaBoundary,
  extractJetWorkPresentationMetadata,
  stripJetWorkPresentationMetadata,
} from './presentationMetadataBoundaryQuality.ts'

const downstreamFetch = globalThis.fetch.bind(globalThis)
const ENGINE_VERSION = 'reasoning-engine-v2'
const MAX_CHAT_ATTACHMENTS = 3
const MAX_CHAT_ATTACHMENT_CHARACTERS = 60_000
const cleanString = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
const sha256Text = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const boundedIntegerEnv = (name: string, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(Deno.env.get(name))
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(Math.trunc(parsed), maximum)) : fallback
}

type PreflightRow = {
  outcome: string
  owner_id: string
  workspace_title: string | null
  workspace_project_id: string | null
  prompt_version_id: string
  prompt_version: number
  prompt_text: string
  prompt_model: string
  conversation_id: string
  conversation_state_items: unknown[]
  conversation_revision: number
  turn_id: string | null
  response_text: string | null
  source_refs: unknown[]
  usage: Record<string, unknown>
  response_model: string | null
  lease_token: string | null
}
type RequestStore = {
  active: boolean
  authorization: string
  supabaseUrl: string
  anonKey: string
  workspaceId: string
  messageId: string
  requestedModel: string
  requestHash: string
  preflightPromise?: Promise<PreflightRow | null>
}

const stores = new AsyncLocalStorage<RequestStore | null>()
const urlOf = (input: RequestInfo | URL) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
const responseJson = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Profile': 'public' },
})

const ensurePreflight = (store: RequestStore) => {
  if (store.preflightPromise) return store.preflightPromise
  const started = performance.now()
  store.preflightPromise = downstreamFetch(`${store.supabaseUrl}/rest/v1/rpc/claim_assistant_core_preflight`, {
    method: 'POST',
    headers: {
      Authorization: store.authorization,
      apikey: store.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_workspace_id: store.workspaceId,
      p_message_id: store.messageId,
      p_request_hash: store.requestHash,
      p_model: store.requestedModel,
      p_user_limit_per_minute: boundedIntegerEnv('ASSISTANT_USER_REQUESTS_PER_MINUTE', 6, 1, 60),
      p_workspace_limit_per_minute: boundedIntegerEnv('ASSISTANT_WORKSPACE_REQUESTS_PER_MINUTE', 30, 1, 240),
    }),
  }).then(async response => {
    if (!response.ok) {
      console.warn('ASSISTANT_CORE_PREFLIGHT_COALESCE_FALLBACK', response.status, await response.text().catch(() => ''))
      return null
    }
    const payload = await response.json()
    const row = (Array.isArray(payload) ? payload[0] : payload) as PreflightRow | null
    if (!row || row.outcome === 'fallback') return null
    console.info('ASSISTANT_CORE_PREFLIGHT_COALESCED', JSON.stringify({
      messageId: store.messageId,
      outcome: row.outcome,
      rpcMs: Math.round(performance.now() - started),
    }))
    return row
  }).catch(error => {
    console.warn('ASSISTANT_CORE_PREFLIGHT_COALESCE_ERROR', String(error).slice(0, 600))
    return null
  })
  return store.preflightPromise
}

const conversationFrom = (store: RequestStore, row: PreflightRow) => ({
  id: row.conversation_id,
  workspace_id: store.workspaceId,
  owner_id: row.owner_id,
  prompt_version_id: row.prompt_version_id,
  model: store.requestedModel,
  status: 'active',
  state_items: Array.isArray(row.conversation_state_items) ? row.conversation_state_items : [],
  revision: Number(row.conversation_revision || 0),
})

const sanitizeCompletionRequest = (init?: RequestInit): RequestInit | undefined => {
  if (!init || typeof init.body !== 'string') return init
  try {
    const payload = JSON.parse(init.body) as Record<string, unknown>
    if (typeof payload.p_response_text !== 'string') return init
    const extracted = extractJetWorkPresentationMetadata(payload.p_response_text)
    if (extracted.strippedBlocks <= 0) return init
    payload.p_response_text = extracted.visibleText
    const usage = payload.p_usage && typeof payload.p_usage === 'object' && !Array.isArray(payload.p_usage)
      ? payload.p_usage as Record<string, unknown>
      : {}
    const previous = Number(usage.presentation_metadata_stripped || 0)
    payload.p_usage = {
      ...usage,
      presentation_metadata_stripped: (Number.isFinite(previous) ? previous : 0) + extracted.strippedBlocks,
    }
    return { ...init, body: JSON.stringify(payload) }
  } catch {
    return init
  }
}

const nextSseFrame = (buffer: string): { frame: string; rest: string } | null => {
  const match = /\r?\n\r?\n/u.exec(buffer)
  if (!match || match.index === undefined) return null
  return {
    frame: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  }
}

const sanitizeTextDeltaFrame = (
  frame: string,
  boundary: ReturnType<typeof createJetWorkPresentationDeltaBoundary>,
): string => {
  const lines = frame.split(/\r?\n/u)
  let eventName = ''
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length) return frame
  const data = dataLines.join('\n')
  if (data === '[DONE]') return frame

  let payload: Record<string, unknown>
  try { payload = JSON.parse(data) as Record<string, unknown> } catch { return frame }
  const eventType = String(eventName || payload.type || '')
  if (eventType !== 'text_delta') return frame

  const result = boundary.push(String(payload.delta || ''))
  if (!result.delta) return ''
  payload.delta = result.delta
  return `event: ${eventName || 'text_delta'}\ndata: ${JSON.stringify(payload)}`
}

const sanitizeAssistantSseResponse = (response: Response): Response => {
  const contentType = response.headers.get('content-type') || ''
  if (!response.body || !contentType.toLocaleLowerCase('en-US').includes('text/event-stream')) return response

  const boundary = createJetWorkPresentationDeltaBoundary()
  let sseBuffer = ''
  const transformed = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream<string, string>({
      transform(chunk, controller) {
        sseBuffer += chunk
        while (true) {
          const next = nextSseFrame(sseBuffer)
          if (!next) break
          sseBuffer = next.rest
          const sanitized = sanitizeTextDeltaFrame(next.frame, boundary)
          if (sanitized) controller.enqueue(`${sanitized}\n\n`)
        }
      },
      flush(controller) {
        if (sseBuffer) {
          const sanitized = sanitizeTextDeltaFrame(sseBuffer, boundary)
          if (sanitized) controller.enqueue(sanitized)
          sseBuffer = ''
        }
        const tail = boundary.finish()
        if (tail.delta) {
          controller.enqueue(`event: text_delta\ndata: ${JSON.stringify({ type: 'text_delta', delta: tail.delta })}\n\n`)
        }
      },
    }))
    .pipeThrough(new TextEncoderStream())

  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(transformed, { status: response.status, statusText: response.statusText, headers })
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const store = stores.getStore()
  if (!store?.active) return downstreamFetch(input, init)
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  let url: URL
  try { url = new URL(urlOf(input)) } catch { return downstreamFetch(input, init) }
  const path = url.pathname

  if (method === 'GET' && /\/rest\/v1\/workspaces$/u.test(path)) {
    const idFilter = url.searchParams.get('id') || ''
    const select = url.searchParams.get('select') || ''
    if (idFilter === `eq.${store.workspaceId}` && select.includes('project_id')) {
      const row = await ensurePreflight(store)
      if (row) return responseJson({ id: store.workspaceId, title: row.workspace_title, project_id: row.workspace_project_id })
    }
  }

  if (method === 'POST' && /\/rest\/v1\/rpc\/get_active_assistant_prompt$/u.test(path)) {
    const row = await ensurePreflight(store)
    if (row) return responseJson([{
      id: row.prompt_version_id,
      workspace_id: null,
      version: row.prompt_version,
      prompt_text: row.prompt_text,
      model: row.prompt_model,
    }])
  }

  if (method === 'GET' && /\/rest\/v1\/assistant_conversations$/u.test(path)) {
    const row = await ensurePreflight(store)
    if (row) return responseJson(conversationFrom(store, row))
  }

  if (method === 'POST' && /\/rest\/v1\/rpc\/claim_assistant_turn$/u.test(path)) {
    const row = await ensurePreflight(store)
    if (row) return responseJson([{
      outcome: row.outcome,
      turn_id: row.turn_id,
      response_text: row.response_text ? stripJetWorkPresentationMetadata(row.response_text) : row.response_text,
      source_refs: Array.isArray(row.source_refs) ? row.source_refs : [],
      usage: row.usage && typeof row.usage === 'object' ? row.usage : {},
      response_model: row.response_model,
      lease_token: row.lease_token,
    }])
  }

  if (method === 'POST' && /\/rest\/v1\/rpc\/complete_assistant_turn$/u.test(path)) {
    return downstreamFetch(input, sanitizeCompletionRequest(init))
  }

  return downstreamFetch(input, init)
}

export async function serve(handler: any, options: any = {}) {
  return telemetryServe(async (request: Request, connInfo: any) => {
    const runAndSanitize = async () => sanitizeAssistantSseResponse(await handler(request, connInfo))
    if (request.method !== 'POST') return runAndSanitize()
    let body: Record<string, any> | null = null
    try { body = await request.clone().json() as Record<string, any> } catch { return runAndSanitize() }

    const authorization = request.headers.get('Authorization') || ''
    const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/u, '')
    const anonKey = String(Deno.env.get('SUPABASE_ANON_KEY') || '')
    const workspaceId = cleanString(body?.workspaceId, 200)
    const messageId = cleanString(body?.messageId, 200)
    const message = cleanString(body?.message, 32_000)
    const requestedModel = cleanString(body?.model, 80)
    if (!authorization || !supabaseUrl || !anonKey || !workspaceId || !messageId || !requestedModel || requestedModel === 'auto') {
      return runAndSanitize()
    }

    const chatAttachments: Array<{ name: string; mimeType: string; content: string }> = []
    let remaining = MAX_CHAT_ATTACHMENT_CHARACTERS
    if (Array.isArray(body?.chatAttachments)) {
      for (const candidate of body.chatAttachments.slice(0, MAX_CHAT_ATTACHMENTS)) {
        if (!candidate || typeof candidate !== 'object' || remaining <= 0) continue
        const content = cleanString(candidate.content, remaining)
        if (!content) continue
        chatAttachments.push({
          name: cleanString(candidate.name || 'chat-attachment.txt', 240),
          mimeType: cleanString(candidate.mimeType || 'text/plain', 120),
          content,
        })
        remaining -= content.length
      }
    }
    const requestHash = await sha256Text(stableJson({ message, chatAttachments, requestedModel, engine: ENGINE_VERSION }))
    const store: RequestStore = {
      active: true,
      authorization,
      supabaseUrl,
      anonKey,
      workspaceId,
      messageId,
      requestedModel,
      requestHash,
    }
    const response = await stores.run(store, () => handler(request, connInfo))
    return sanitizeAssistantSseResponse(response)
  }, options)
}
