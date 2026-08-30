import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import {
  applyRequirementGroundingGuard,
  classifyDocumentArtifactRequest,
  isDocumentRevisionRequest,
  isGroundedRequirementRequest,
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

const eventName = (frame: string) => frame
  .split(/\r?\n/u)
  .find(line => line.startsWith('event:'))
  ?.slice('event:'.length)
  .trim() || ''

const eventData = (frame: string) => frame
  .split(/\r?\n/u)
  .filter(line => line.startsWith('data:'))
  .map(line => line.slice('data:'.length).trimStart())
  .join('\n')

const encodeEvent = (encoder: TextEncoder, name: string, payload: unknown) => encoder.encode(
  `${name ? `event: ${name}\n` : ''}data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`,
)

const isEnerjisaAnalysisAttachment = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attachment = value as Record<string, unknown>
  const name = clean(attachment.name, 260)
  const mime = clean(attachment.mimeType, 160).toLocaleLowerCase('en-US')
  const purpose = clean(attachment.purpose, 40)
  if (purpose !== 'tool_output') return false
  const docx = /\.docx$/iu.test(name)
    || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return docx && /(?:enerjisa|is[-_ ]?analizi|iş[-_ ]?analizi)/iu.test(name)
}

async function loadRecentArtifactContext(
  client: ReturnType<typeof createClient>,
  workspaceId: string,
  messageId: string,
  currentMessage: string,
) {
  if (!workspaceId) return { priorUser: '', recentContext: '' }
  const { data, error } = await client
    .from('messages')
    .select('id,role,text,created_at')
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'model'])
    .order('created_at', { ascending: false })
    .limit(8)
  if (error) {
    console.warn('Artifact continuation context lookup failed:', error.message)
    return { priorUser: '', recentContext: '' }
  }
  const rows = (data || []).filter(row => String(row.id || '') !== messageId)
  const currentUserText = clean(currentMessage, 26_000)
  const priorUserRows = rows.filter(row => (
    row.role === 'user'
    && clean(row.text, 26_000)
    && clean(row.text, 26_000) !== currentUserText
  ))
  // Short retry/follow-up messages must not replace the substantive requirement
  // that the artifact is supposed to represent. Prefer the nearest substantial
  // user input; fall back to the latest distinct user input when none exists.
  const priorUserRow = priorUserRows.find(row => clean(row.text, 26_000).length >= 400) || priorUserRows[0]
  const priorUser = priorUserRow ? clean(priorUserRow.text, 26_000) : ''
  const recentContext = [...rows]
    .reverse()
    .slice(-4)
    .map(row => `${row.role === 'user' ? 'user' : 'assistant'}: ${clean(row.text, 4_000)}`)
    .filter(Boolean)
    .join('\n\n')
  return { priorUser, recentContext }
}

async function hasRecentEnerjisaAnalysisDocx(client: ReturnType<typeof createClient>, workspaceId: string) {
  if (!workspaceId) return false
  const { data, error } = await client
    .from('messages')
    .select('attachments,text,created_at')
    .eq('workspace_id', workspaceId)
    .eq('role', 'model')
    .order('created_at', { ascending: false })
    .limit(12)
  if (error) {
    console.warn('Document revision context lookup failed:', error.message)
    return false
  }
  return (data || []).some(row => {
    const attachments = Array.isArray(row.attachments) ? row.attachments : []
    if (attachments.some(isEnerjisaAnalysisAttachment)) return true
    const text = clean(row.text, 2_000)
    return /enerjisa/iu.test(text) && /iş analizi|is analizi/iu.test(text) && /docx|word|doküman|dokuman/iu.test(text)
  })
}

async function loadPersistedArtifacts(
  client: ReturnType<typeof createClient>,
  workspaceId: string,
  messageId: string,
): Promise<Array<Record<string, unknown>>> {
  if (!workspaceId || !messageId) return []
  const { data, error } = await client.rpc('get_assistant_turn_artifacts', {
    p_workspace_id: workspaceId,
    p_message_id: messageId,
  })
  if (error) {
    // The migration can briefly lag the edge deployment during rollout. Never
    // fail an otherwise valid assistant response just because recovery metadata
    // is not available yet.
    console.warn('Assistant artifact recovery lookup failed:', error.message)
    return []
  }
  return Array.isArray(data)
    ? data.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
    : []
}

function enrichAssistantSse(
  stream: ReadableStream<Uint8Array>,
  loadArtifacts: () => Promise<Array<Record<string, unknown>>>,
) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      let artifactsSeen = false

      const forwardFrame = async (frame: string) => {
        if (!frame.trim()) return
        const name = eventName(frame)
        const data = eventData(frame)
        if (name === 'artifacts') artifactsSeen = true
        if (name === 'completed' && !artifactsSeen) {
          const artifacts = await loadArtifacts().catch(() => [])
          if (artifacts.length) {
            controller.enqueue(encodeEvent(encoder, 'artifacts', { type: 'artifacts', artifacts }))
            artifactsSeen = true
          }
        }
        controller.enqueue(encoder.encode(`${frame}\n\n`))
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          const frames = buffer.split('\n\n')
          buffer = frames.pop() || ''
          for (const frame of frames) await forwardFrame(frame)
        }
        buffer += decoder.decode().replace(/\r\n/g, '\n')
        if (buffer.trim()) await forwardFrame(buffer)
        controller.close()
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
  })
}

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
  const workspaceId = clean(payload.workspaceId, 200)
  const messageId = clean(payload.messageId, 240)
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  const routeDecision = classifyDocumentArtifactRequest(message)
  const artifactContext = !routeDecision.artifactRoute
    ? await loadRecentArtifactContext(client, workspaceId, messageId, message)
    : { priorUser: '', recentContext: '' }
  const contextualDecision = !routeDecision.artifactRoute && artifactContext.recentContext
    ? classifyDocumentArtifactRequest(`${artifactContext.recentContext}\n\ncurrent user request: ${message}`)
    : routeDecision
  const contextualEnerjisaCreation = !routeDecision.enerjisaAnalysisDocx
    && contextualDecision.enerjisaAnalysisDocx
    && Boolean(artifactContext.priorUser)
  const revisionCandidate = isDocumentRevisionRequest(message)
  const revisionOfEnerjisaAnalysis = !routeDecision.enerjisaAnalysisDocx
    && revisionCandidate
    && await hasRecentEnerjisaAnalysisDocx(client, workspaceId)
  const enerjisaAnalysisDocx = routeDecision.enerjisaAnalysisDocx || contextualEnerjisaCreation || revisionOfEnerjisaAnalysis
  const groundedRequirement = !enerjisaAnalysisDocx && isGroundedRequirementRequest(message)
  // Long inputs require the full semantic/capability runtime. Intent is still
  // resolved inside the semantic orchestrator, not here from business keywords.
  const longContextNeedsReasoning = message.length >= 2_000
  const artifactRoute = routeDecision.artifactRoute || enerjisaAnalysisDocx
  const target = enerjisaAnalysisDocx
    ? 'openai-assistant-enerjisa-docx'
    : artifactRoute || groundedRequirement || longContextNeedsReasoning
      ? 'openai-assistant-v2-internal'
      : 'openai-assistant-v2-primary'

  const contextualArtifactMessage = contextualEnerjisaCreation
    ? `${artifactContext.priorUser}\n\n[KULLANICI DEVAM TALİMATI]\n${message}`
    : message
  const upstreamPayload = groundedRequirement
    ? { ...payload, message: applyRequirementGroundingGuard(message) }
    : contextualEnerjisaCreation
      ? { ...payload, message: contextualArtifactMessage }
      : payload

  // Preserve the original user message for normal document generation/revision.
  // Enerjisa's long template is appended only after semantic intent planning
  // inside openai-assistant-enerjisa-docx. Requirement-only requests receive a
  // small grounding guard and are sent through the reasoning runtime.
  const upstreamBody = new TextEncoder().encode(JSON.stringify(upstreamPayload))

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/${target}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': enerjisaAnalysisDocx
          ? 'jetwork-enerjisa-analysis-docx-postplan-route/v2'
          : groundedRequirement
            ? 'jetwork-grounded-requirements-route/v1'
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
  headers.set('x-jetwork-runtime-route', enerjisaAnalysisDocx
    ? revisionOfEnerjisaAnalysis
      ? 'enerjisa-analysis-docx-revision-v1'
      : contextualEnerjisaCreation
        ? 'enerjisa-analysis-docx-contextual-v1'
        : 'enerjisa-analysis-docx-postplan-v2'
    : groundedRequirement
      ? 'grounded-requirements-v1'
      : artifactRoute
        ? 'docx-reasoning-v2'
        : 'primary-agent')

  const contentType = upstream.headers.get('Content-Type') || upstream.headers.get('content-type') || ''
  if (!upstream.body || !contentType.includes('text/event-stream')) {
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
  }

  return new Response(
    enrichAssistantSse(upstream.body, () => loadPersistedArtifacts(client, workspaceId, messageId)),
    { status: upstream.status, statusText: upstream.statusText, headers },
  )
})
