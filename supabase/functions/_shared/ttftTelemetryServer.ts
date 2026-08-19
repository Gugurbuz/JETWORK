import {
  serve as baseServe,
  type Handler,
  type ServeInit,
} from 'https://deno.land/std@0.168.0/http/server.ts?jetwork-ttft-base=1'
import { AsyncLocalStorage } from 'node:async_hooks'

type ProviderKind = 'openai' | 'gemini'

type ProviderObservation = {
  provider: ProviderKind
  sentAtMs: number
  headersAtMs?: number
  firstByteAtMs?: number
  firstTextAtMs?: number
}

type TtftTrace = {
  traceId: string
  messageId: string
  requestReceivedAtMs: number
  authDoneAtMs?: number
  workspaceDoneAtMs?: number
  promptDoneAtMs?: number
  turnClaimedAtMs?: number
  reasoningReadyAtMs?: number
  firstTextDeltaAtMs?: number
  coreForwardStartedAtMs?: number
  providerObservations: ProviderObservation[]
  breakdownLogged: boolean
}

type TtftGlobal = typeof globalThis & {
  __jetworkTtftInstalled?: boolean
  __jetworkTtftOriginalFetch?: typeof fetch
}

const traces = new AsyncLocalStorage<TtftTrace>()
const globalState = globalThis as TtftGlobal
const roundMs = (value: number | undefined) => value === undefined ? undefined : Math.round(value)
const duration = (start: number | undefined, end: number | undefined) => (
  start === undefined || end === undefined ? undefined : roundMs(end - start)
)

const safeJson = (value: string) => {
  try { return JSON.parse(value) as Record<string, unknown> }
  catch { return null }
}

const messageIdFromBody = (body: unknown) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  const candidate = body as Record<string, unknown>
  return String(candidate.messageId || candidate.p_message_id || '').trim().slice(0, 240)
}

const requestUrl = (input: RequestInfo | URL) => (
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
)

const providerKindForUrl = (url: string): ProviderKind | null => {
  if (/api\.openai\.com\/v1\/responses/i.test(url)) return 'openai'
  if (/generativelanguage\.googleapis\.com|googleapis\.com\/.*generativelanguage/i.test(url)) return 'gemini'
  return null
}

const requestBodyObject = (input: RequestInfo | URL, init?: RequestInit) => {
  const body = typeof init?.body === 'string'
    ? init.body
    : input instanceof Request && typeof input.body === 'string'
      ? input.body
      : undefined
  return body ? safeJson(body) : null
}

const isFinalAnswerProviderRequest = (
  provider: ProviderKind,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  trace: TtftTrace,
) => {
  if (trace.turnClaimedAtMs === undefined) return false

  // Gemini planning/verification in this runtime is deterministic when Gemini is
  // the active provider, so post-claim Gemini calls belong to answer/tool rounds.
  if (provider === 'gemini') return true

  // OpenAI planning uses the same Responses endpoint as final synthesis. The
  // final answer request is distinguishable by safety_identifier, which the
  // planner/verification request deliberately does not send.
  const body = requestBodyObject(input, init)
  return Boolean(body && typeof body.safety_identifier === 'string' && body.safety_identifier)
}

const parseSseFrames = (buffer: string) => {
  const frames: string[] = []
  let cursor = 0
  const separator = /\r?\n\r?\n/g
  let match: RegExpExecArray | null
  while ((match = separator.exec(buffer)) !== null) {
    frames.push(buffer.slice(cursor, match.index))
    cursor = match.index + match[0].length
  }
  return { frames, remainder: buffer.slice(cursor) }
}

const jsonFromSseFrame = (frame: string) => {
  const data = frame
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /, ''))
    .join('\n')
  if (!data || data === '[DONE]') return null
  return safeJson(data)
}

const hasVisibleProviderText = (payload: Record<string, unknown>, provider: ProviderKind) => {
  if (provider === 'openai') {
    const type = String(payload.type || '')
    return (type === 'response.output_text.delta' || type === 'response.refusal.delta')
      && Boolean(String(payload.delta || ''))
  }
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  return candidates.some(candidate => {
    if (!candidate || typeof candidate !== 'object') return false
    const content = (candidate as Record<string, unknown>).content
    if (!content || typeof content !== 'object' || Array.isArray(content)) return false
    const parts = Array.isArray((content as Record<string, unknown>).parts)
      ? (content as Record<string, unknown>).parts as unknown[]
      : []
    return parts.some(part => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return false
      const record = part as Record<string, unknown>
      return record.thought !== true && Boolean(String(record.text || ''))
    })
  })
}

const observeProviderBody = (
  response: Response,
  observation: ProviderObservation,
) => {
  if (!response.body) return
  let clone: Response
  try { clone = response.clone() }
  catch { return }
  const reader = clone.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.byteLength && observation.firstByteAtMs === undefined) {
          observation.firstByteAtMs = performance.now()
        }
        if (!value?.byteLength) continue
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseSseFrames(buffer)
        buffer = parsed.remainder
        for (const frame of parsed.frames) {
          const payload = jsonFromSseFrame(frame)
          if (payload && hasVisibleProviderText(payload, observation.provider)) {
            observation.firstTextAtMs = performance.now()
            await reader.cancel().catch(() => undefined)
            return
          }
        }
      }
    } catch {
      // Telemetry must never interfere with the provider stream.
    }
  })()
}

const selectedProviderObservation = (trace: TtftTrace) => {
  const beforeDelta = trace.providerObservations.filter(item => (
    trace.firstTextDeltaAtMs === undefined || item.sentAtMs <= trace.firstTextDeltaAtMs
  ))
  const withText = beforeDelta.filter(item => (
    item.firstTextAtMs !== undefined
    && (trace.firstTextDeltaAtMs === undefined || item.firstTextAtMs <= trace.firstTextDeltaAtMs + 250)
  ))
  return withText[withText.length - 1] || beforeDelta[beforeDelta.length - 1]
}

const logBreakdown = (trace: TtftTrace) => {
  if (trace.breakdownLogged || trace.firstTextDeltaAtMs === undefined) return
  trace.breakdownLogged = true
  const provider = selectedProviderObservation(trace)
  console.info('ASSISTANT_TTFT_BREAKDOWN', JSON.stringify({
    traceId: trace.traceId,
    messageId: trace.messageId || undefined,
    provider: provider?.provider,
    providerRoundCount: trace.providerObservations.length,
    requestToAuthMs: duration(trace.requestReceivedAtMs, trace.authDoneAtMs),
    authToWorkspaceMs: duration(trace.authDoneAtMs, trace.workspaceDoneAtMs),
    workspaceToPromptMs: duration(trace.workspaceDoneAtMs, trace.promptDoneAtMs),
    promptToTurnClaimMs: duration(trace.promptDoneAtMs, trace.turnClaimedAtMs),
    turnClaimToReasoningReadyMs: duration(trace.turnClaimedAtMs, trace.reasoningReadyAtMs),
    reasoningReadyToProviderRequestMs: duration(trace.reasoningReadyAtMs, provider?.sentAtMs),
    providerRequestToHeadersMs: duration(provider?.sentAtMs, provider?.headersAtMs),
    providerRequestToFirstByteMs: duration(provider?.sentAtMs, provider?.firstByteAtMs),
    providerFirstByteToFirstTextMs: duration(provider?.firstByteAtMs, provider?.firstTextAtMs),
    providerRequestToFirstTextMs: duration(provider?.sentAtMs, provider?.firstTextAtMs),
    providerFirstTextToCoreDeltaMs: duration(provider?.firstTextAtMs, trace.firstTextDeltaAtMs),
    requestToFirstTextDeltaMs: duration(trace.requestReceivedAtMs, trace.firstTextDeltaAtMs),
  }))
}

const inspectCoreSse = (trace: TtftTrace, text: string) => {
  const parsed = parseSseFrames(text)
  for (const frame of parsed.frames) {
    const eventName = frame.split(/\r?\n/).find(line => line.startsWith('event:'))?.slice(6).trim() || ''
    const payload = jsonFromSseFrame(frame)
    if (!payload) continue
    const eventType = eventName || String(payload.type || '')
    if (eventType === 'status') {
      const label = String(payload.label || '')
      if (trace.reasoningReadyAtMs === undefined && /Plan hazır:/iu.test(label)) {
        trace.reasoningReadyAtMs = performance.now()
      }
    }
    if (eventType === 'text_delta' && String(payload.delta || '')) {
      if (trace.firstTextDeltaAtMs === undefined) trace.firstTextDeltaAtMs = performance.now()
      logBreakdown(trace)
    }
  }
  return parsed.remainder
}

const wrapCoreResponse = (response: Response, trace: TtftTrace) => {
  if (!response.body || !/text\/event-stream/i.test(response.headers.get('content-type') || '')) return response
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let inspectionBuffer = ''
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      if (value) {
        inspectionBuffer += decoder.decode(value, { stream: true })
        inspectionBuffer = inspectCoreSse(trace, inspectionBuffer)
        controller.enqueue(value)
      }
    },
    cancel(reason) { return reader.cancel(reason) },
  })
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

const withTraceHeaders = (input: RequestInfo | URL, init: RequestInit | undefined, trace: TtftTrace) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  headers.set('x-jetwork-ttft-trace', trace.traceId)
  if (trace.messageId) headers.set('x-jetwork-message-id', trace.messageId)
  return { ...init, headers }
}

const installFetchTelemetry = () => {
  if (globalState.__jetworkTtftInstalled) return
  globalState.__jetworkTtftInstalled = true
  const originalFetch = globalState.__jetworkTtftOriginalFetch || globalThis.fetch.bind(globalThis)
  globalState.__jetworkTtftOriginalFetch = originalFetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const trace = traces.getStore()
    if (!trace) return originalFetch(input, init)

    const url = requestUrl(input)
    const lowerUrl = url.toLocaleLowerCase('en-US')
    let nextInit = init
    const forwardingToBaseCore = /\/functions\/v1\/openai-assistant-core-v2-base(?:\?|$)/i.test(url)
    if (forwardingToBaseCore) {
      trace.coreForwardStartedAtMs ??= performance.now()
      console.info('ASSISTANT_TTFT_ROUTER_BREAKDOWN', JSON.stringify({
        traceId: trace.traceId,
        messageId: trace.messageId || undefined,
        routerToCoreMs: duration(trace.requestReceivedAtMs, trace.coreForwardStartedAtMs),
      }))
      nextInit = withTraceHeaders(input, init, trace)
    }

    const provider = providerKindForUrl(url)
    const observation = provider && isFinalAnswerProviderRequest(provider, input, nextInit, trace)
      ? { provider, sentAtMs: performance.now() } as ProviderObservation
      : null
    if (observation) trace.providerObservations.push(observation)

    const response = await originalFetch(input, nextInit)
    const completedAt = performance.now()

    if (/\/auth\/v1\/user(?:\?|$)/i.test(lowerUrl) && trace.authDoneAtMs === undefined) {
      trace.authDoneAtMs = completedAt
    } else if (/\/rest\/v1\/workspaces(?:\?|$)/i.test(lowerUrl) && trace.workspaceDoneAtMs === undefined) {
      trace.workspaceDoneAtMs = completedAt
    } else if (/\/rest\/v1\/rpc\/get_active_assistant_prompt(?:\?|$)/i.test(lowerUrl) && trace.promptDoneAtMs === undefined) {
      trace.promptDoneAtMs = completedAt
    } else if (/\/rest\/v1\/rpc\/claim_assistant_turn(?:\?|$)/i.test(lowerUrl) && trace.turnClaimedAtMs === undefined) {
      trace.turnClaimedAtMs = completedAt
      const rawBody = typeof nextInit?.body === 'string' ? safeJson(nextInit.body) : null
      trace.messageId ||= messageIdFromBody(rawBody)
    }

    if (observation) {
      observation.headersAtMs = completedAt
      observeProviderBody(response, observation)
    }
    return response
  }
}

installFetchTelemetry()

export async function serve(handler: Handler, options: ServeInit = {}) {
  return baseServe((request, connInfo) => {
    const trace: TtftTrace = {
      traceId: request.headers.get('x-jetwork-ttft-trace') || crypto.randomUUID(),
      messageId: request.headers.get('x-jetwork-message-id') || '',
      requestReceivedAtMs: performance.now(),
      providerObservations: [],
      breakdownLogged: false,
    }

    if (!trace.messageId && request.method === 'POST') {
      void request.clone().json()
        .then(body => { trace.messageId ||= messageIdFromBody(body) })
        .catch(() => undefined)
    }

    return traces.run(trace, async () => {
      const response = await handler(request, connInfo)
      return wrapCoreResponse(response, trace)
    })
  }, options)
}
