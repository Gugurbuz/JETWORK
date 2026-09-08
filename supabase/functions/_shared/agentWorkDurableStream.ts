import { createSafeStreamSink } from './safeStreamSink.ts'

const PREFIX = 'jetwork-agent-work:v1:'
const CANONICAL_EVENT_NAMES = new Set(['agent_activity', 'tool_start', 'tool_complete', 'artifact', 'warning', 'final'])
const SOURCE_TYPES = new Set(['knowledge', 'web', 'media', 'github', 'vercel', 'artifact', 'runtime'])
const STATES = new Set(['pending', 'active', 'completed', 'warning', 'failed'])

interface DurableAgentWorkEvent {
  eventId: string
  sequence: number
  kind: 'agent' | 'tool' | 'source' | 'artifact' | 'warning' | 'final'
  label: string
  tool?: string
  sourceType: 'knowledge' | 'web' | 'media' | 'github' | 'vercel' | 'artifact' | 'runtime'
  startedAt?: string
  completedAt?: string
  state: 'pending' | 'active' | 'completed' | 'warning' | 'failed'
  rawLabel?: string
}

interface DurableAgentWorkStreamInput {
  stream: ReadableStream<Uint8Array>
  supabaseUrl: string
  anonKey: string
  authorization: string
  workspaceId: string
  messageId: string
  onPersistenceMiss?: (observation: { assistantId: string; eventCount: number }) => void
}

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mapKind = (kind: string, eventName: string): DurableAgentWorkEvent['kind'] => {
  if (kind === 'tool' || eventName === 'tool_start' || eventName === 'tool_complete') return 'tool'
  if (kind === 'source') return 'source'
  if (kind === 'artifact' || eventName === 'artifact') return 'artifact'
  if (kind === 'warning' || eventName === 'warning') return 'warning'
  if (kind === 'final' || eventName === 'final') return 'final'
  return 'agent'
}

const parseCanonicalFrame = (frame: string): DurableAgentWorkEvent | null => {
  const eventName = clean(
    frame.split(/\r?\n/u).find(line => line.startsWith('event:'))?.slice('event:'.length),
    80,
  )
  if (!CANONICAL_EVENT_NAMES.has(eventName)) return null

  const data = frame
    .split(/\r?\n/u)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart())
    .join('\n')
  if (!data || data === '[DONE]') return null

  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    payload = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const eventId = clean(payload.event_id, 240)
  const sequence = Number(payload.sequence)
  const label = clean(payload.label, 1_000)
  if (!eventId || !Number.isFinite(sequence) || sequence < 1 || !label) return null

  const sourceTypeCandidate = clean(payload.source_type, 40)
  const sourceType = SOURCE_TYPES.has(sourceTypeCandidate)
    ? sourceTypeCandidate as DurableAgentWorkEvent['sourceType']
    : 'runtime'
  const stateCandidate = clean(payload.state, 40)
  const state = STATES.has(stateCandidate)
    ? stateCandidate as DurableAgentWorkEvent['state']
    : eventName === 'tool_start'
      ? 'active'
      : eventName === 'warning'
        ? 'warning'
        : 'completed'

  return {
    eventId,
    sequence: Math.trunc(sequence),
    kind: mapKind(clean(payload.kind, 40), eventName),
    label,
    tool: clean(payload.tool, 160) || undefined,
    sourceType,
    startedAt: clean(payload.started_at, 80) || undefined,
    completedAt: clean(payload.completed_at, 80) || undefined,
    state,
    rawLabel: label,
  }
}

const reduceEvent = (events: DurableAgentWorkEvent[], incoming: DurableAgentWorkEvent) => {
  const index = events.findIndex(event => event.eventId === incoming.eventId)
  if (index >= 0) events[index] = { ...events[index], ...incoming }
  else events.push(incoming)
  events.sort((left, right) => left.sequence - right.sequence)
}

/**
 * Canonical Agent Work durability boundary.
 *
 * The upstream assistant stream may contain legacy status/commentary and native
 * provider_step frames. SafeStreamSink converts those to the public canonical
 * Agent Work side-channel. This wrapper observes only that transformed public
 * side-channel and persists it into messages.raw_response before exposing a
 * terminally closed stream to the browser.
 *
 * No private chain-of-thought, provider request payload, tool arguments or raw
 * tool outputs are persisted here.
 */
export function createDurableAgentWorkStream(input: DurableAgentWorkStreamInput): ReadableStream<Uint8Array> {
  const reader = input.stream.getReader()
  const events: DurableAgentWorkEvent[] = []
  const decoder = new TextDecoder()
  let buffer = ''
  let persistenceAttempted = false

  const observeChunk = (chunk: Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/u)
    buffer = frames.pop() || ''
    for (const rawFrame of frames) {
      const event = parseCanonicalFrame(`${rawFrame}\n\n`)
      if (event) reduceEvent(events, event)
    }
  }

  const persist = async () => {
    if (persistenceAttempted || !input.workspaceId || !input.messageId || events.length === 0) return
    persistenceAttempted = true

    const assistantId = `assistant:${input.messageId}`
    const endpoint = `${input.supabaseUrl.replace(/\/$/u, '')}/rest/v1/messages?id=eq.${encodeURIComponent(assistantId)}&workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
    const rawResponse = `${PREFIX}${JSON.stringify({ version: 1, workEvents: events })}`

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          Authorization: input.authorization,
          apikey: input.anonKey,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ raw_response: rawResponse }),
      }).catch(() => null)

      if (response?.ok) {
        const rows = await response.json().catch(() => []) as unknown[]
        if (Array.isArray(rows) && rows.length > 0) return
      }
      await sleep(250 * (attempt + 1))
    }

    input.onPersistenceMiss?.({ assistantId, eventCount: events.length })
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const observingController = {
        enqueue(chunk: Uint8Array) {
          observeChunk(chunk)
          controller.enqueue(chunk)
        },
        close() {
          controller.close()
        },
      }
      const sink = createSafeStreamSink(observingController)

      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value && !sink.write(value)) break
          }
        } catch {
          if (sink.isOpen()) {
            sink.event('error', {
              type: 'error',
              message: 'Asistan yanıt akışı tamamlanamadı. Lütfen tekrar deneyin.',
            })
          }
        } finally {
          await persist()
          sink.close()
          try { reader.releaseLock() } catch { /* already released */ }
        }
      })()
    },
    cancel(reason) {
      void persist()
      void reader.cancel(reason).catch(() => undefined)
    },
  })
}
