import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { consumeSseBuffer } from '../src/services/sseParser'

const args = process.argv.slice(2)
if (!args.includes('--confirm-staging')) throw new Error('ADAPTIVE_GREEN_STAGING_CONFIRMATION_REQUIRED')

const requiredEnv = (name: string) => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}
const base = (value: string) => value.trim().replace(/\/+$/u, '').toLocaleLowerCase('en-US')
const stagingUrl = requiredEnv('AGENTIC_GOLDEN_STAGING_URL')
const productionUrl = requiredEnv('AGENTIC_GOLDEN_PRODUCTION_URL')
const anonKey = requiredEnv('AGENTIC_GOLDEN_ANON_KEY')
const accessToken = requiredEnv('AGENTIC_GOLDEN_ACCESS_TOKEN')
const model = String(process.env.AGENTIC_GOLDEN_MODEL || 'gemini-3.8-flash').trim() || 'gemini-3.8-flash'
if (base(stagingUrl) === base(productionUrl)) throw new Error('ADAPTIVE_GREEN_PRODUCTION_TARGET_FORBIDDEN')

const client = createClient(stagingUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: authData, error: authError } = await client.auth.getUser(accessToken)
if (authError || !authData.user || authData.user.is_anonymous) throw new Error(`ADAPTIVE_GREEN_STAGING_AUTH:${authError?.message || 'no permanent user'}`)

const workspaceId = `staging-adaptive-green-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
const { error: workspaceError } = await client.from('workspaces').insert({
  id: workspaceId,
  project_id: 'staging-golden-project',
  title: 'Adaptive Green Energy Canary',
  owner_id: authData.user.id,
  collaborators: [],
  document: {},
  title_source: 'user',
})
if (workspaceError) throw new Error(`ADAPTIVE_GREEN_WORKSPACE_CREATE:${workspaceError.message}`)

const scenarios = [
  'Yeşil enerji kontrolünü değiştirmek istiyorum',
  'Teklifteki',
  'Sen bulcaksın',
]

type FramePayload = Record<string, unknown>
type TurnReport = {
  index: number
  message: string
  messageId: string
  answer: string
  runtimeRoute: string
  completed: FramePayload | null
  error: FramePayload | null
  statuses: FramePayload[]
  commentary: FramePayload[]
  agentEvents: Array<{ event: string; payload: FramePayload }>
  sources: FramePayload[]
  timing: { headersMs: number; ttftMs: number | null; totalMs: number }
  turn: FramePayload | null
  reasoning: FramePayload | null
  tools: FramePayload[]
}

const sleep = (ms: number) => new Promise(resolveSleep => setTimeout(resolveSleep, ms))
const reports: TurnReport[] = []

try {
  for (let index = 0; index < scenarios.length; index += 1) {
    const message = scenarios[index]
    const messageId = `adaptive-green-${index + 1}-${crypto.randomUUID()}`
    const { error: messageError } = await client.from('messages').insert({
      id: messageId,
      workspace_id: workspaceId,
      sender_name: authData.user.email?.split('@')[0] || 'Adaptive Golden User',
      sender_role: 'Kullanıcı',
      text: message,
      is_ai: false,
      attachments: [],
      reactions: [],
      role: 'user',
      owner_id: authData.user.id,
    })
    if (messageError) throw new Error(`ADAPTIVE_GREEN_USER_MESSAGE_${index + 1}:${messageError.message}`)

    const startedAt = performance.now()
    const response = await fetch(`${base(stagingUrl)}/functions/v1/openai-assistant-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'x-client-info': 'jetwork-adaptive-green-energy-staging/1',
      },
      body: JSON.stringify({ workspaceId, messageId, message, model, workMode: 'balanced', chatAttachments: [] }),
    })
    const headersAt = performance.now()
    const runtimeRoute = response.headers.get('x-jetwork-runtime-route') || ''
    if (!response.ok) throw new Error(`ADAPTIVE_GREEN_HTTP_${index + 1}_${response.status}:${(await response.text()).slice(0, 1200)}`)
    if (!response.body) throw new Error(`ADAPTIVE_GREEN_EMPTY_STREAM_${index + 1}`)

    let answer = ''
    let completed: FramePayload | null = null
    let error: FramePayload | null = null
    let firstTextAt: number | null = null
    const statuses: FramePayload[] = []
    const commentary: FramePayload[] = []
    const agentEvents: Array<{ event: string; payload: FramePayload }> = []
    const sourceMap = new Map<string, FramePayload>()
    const handle = (event: { event?: string; data: string }) => {
      if (event.data === '[DONE]') return
      let payload: FramePayload
      try {
        const parsed = JSON.parse(event.data)
        if (!parsed || typeof parsed !== 'object') return
        payload = parsed as FramePayload
      } catch { return }
      const type = String(event.event || payload.type || '')
      if (type === 'text_delta') {
        const delta = String(payload.delta || '')
        answer += delta
        if (firstTextAt === null && delta.trim()) firstTextAt = performance.now()
      } else if (type === 'status') statuses.push(payload)
      else if (type === 'commentary') commentary.push(payload)
      else if (['agent_activity','tool_start','tool_complete','final','warning'].includes(type)) agentEvents.push({ event: type, payload })
      else if (type === 'sources') {
        for (const raw of Array.isArray(payload.sources) ? payload.sources : []) {
          if (!raw || typeof raw !== 'object') continue
          const source = raw as FramePayload
          const key = [source.sourceType, source.sourceId, source.canonicalKey, source.url, source.sourceName].map(value => String(value || '')).join('|')
          sourceMap.set(key, source)
        }
      } else if (type === 'completed') completed = payload
      else if (type === 'error') error = payload
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = consumeSseBuffer(buffer)
      buffer = parsed.remainder
      parsed.events.forEach(handle)
    }
    buffer += decoder.decode()
    consumeSseBuffer(buffer, true).events.forEach(handle)
    const completedAt = performance.now()

    const aiMessageId = `adaptive-green-ai-${index + 1}-${crypto.randomUUID()}`
    const { error: aiMessageError } = await client.from('messages').insert({
      id: aiMessageId,
      workspace_id: workspaceId,
      sender_name: 'JetWork AI',
      sender_role: 'Sistem Asistanı',
      text: answer,
      is_ai: true,
      attachments: [],
      reactions: [],
      role: 'model',
      owner_id: authData.user.id,
    })
    if (aiMessageError) throw new Error(`ADAPTIVE_GREEN_AI_MESSAGE_${index + 1}:${aiMessageError.message}`)

    await sleep(250)
    const { data: turnRows, error: turnError } = await client.from('assistant_turns')
      .select('id,conversation_id,message_id,status,response_model,usage,source_refs,created_at,completed_at')
      .eq('workspace_id', workspaceId).eq('message_id', messageId).order('created_at', { ascending: false }).limit(1)
    if (turnError) throw new Error(`ADAPTIVE_GREEN_TURN_${index + 1}:${turnError.message}`)
    const turn = (turnRows?.[0] || null) as FramePayload | null
    const turnId = String(turn?.id || '')
    let reasoning: FramePayload | null = null
    let tools: FramePayload[] = []
    if (turnId) {
      const [reasoningResult, toolsResult] = await Promise.all([
        client.from('assistant_reasoning_runs').select('intent,complexity,plan,verification,evidence_summary,knowledge_used,web_used,tool_call_count,fallback_used,status,started_at,completed_at').eq('turn_id', turnId).order('started_at', { ascending: false }).limit(1),
        client.from('assistant_tool_runs').select('tool_name,call_id,arguments,result_summary,source_refs,status,duration_ms,created_at').eq('turn_id', turnId).order('created_at', { ascending: true }),
      ])
      if (reasoningResult.error) throw new Error(`ADAPTIVE_GREEN_REASONING_${index + 1}:${reasoningResult.error.message}`)
      if (toolsResult.error) throw new Error(`ADAPTIVE_GREEN_TOOLS_${index + 1}:${toolsResult.error.message}`)
      reasoning = (reasoningResult.data?.[0] || null) as FramePayload | null
      tools = (toolsResult.data || []) as FramePayload[]
    }

    reports.push({
      index: index + 1,
      message,
      messageId,
      answer,
      runtimeRoute,
      completed,
      error,
      statuses,
      commentary,
      agentEvents,
      sources: [...sourceMap.values()],
      timing: {
        headersMs: Math.max(0, Math.round(headersAt - startedAt)),
        ttftMs: firstTextAt === null ? null : Math.max(0, Math.round(firstTextAt - startedAt)),
        totalMs: Math.max(0, Math.round(completedAt - startedAt)),
      },
      turn,
      reasoning,
      tools,
    })
    await sleep(350)
  }

  const normalized = (value: unknown) => String(value || '').toLocaleLowerCase('tr-TR')
  const planFor = (turn: TurnReport) => (turn.reasoning?.plan && typeof turn.reasoning.plan === 'object' ? turn.reasoning.plan as FramePayload : {})
  const stateFor = (turn: TurnReport) => {
    const plan = planFor(turn)
    return plan.conversationState && typeof plan.conversationState === 'object' ? plan.conversationState as FramePayload : {}
  }
  const allToolNames = reports.flatMap(turn => turn.tools.map(tool => String(tool.tool_name || '')))
  const allSources = reports.flatMap(turn => turn.sources)
  const sourceKeys = allSources.map(source => normalized(source.canonicalKey))
  const progressCalls = reports.flatMap(turn => turn.tools.filter(tool => tool.tool_name === 'report_progress'))
  const genericKnowledgeRows = reports.flatMap(turn => turn.agentEvents).filter(item => /bilgi bankası sorgusu tamamlandı/iu.test(String(item.payload.label || '')))
  const rollingCountRows = reports.flatMap(turn => turn.agentEvents).filter(item => /^\d+\s+kurumsal kaynak bulundu/iu.test(String(item.payload.label || '')))
  const turn2State = stateFor(reports[1])
  const turn3State = stateFor(reports[2])
  const turn2Resolved = normalized(turn2State.resolvedRequest)
  const turn3Resolved = normalized(turn3State.resolvedRequest)
  const turn3Answer = normalized(reports[2].answer)
  const turn2Usage = reports[1].turn?.usage && typeof reports[1].turn?.usage === 'object' ? reports[1].turn?.usage as FramePayload : {}
  const providerCalls = Number(turn2Usage.gemini_interactions_api_calls || turn2Usage.provider_calls || 0)
  const inputTokens = Number(turn2Usage.input_tokens || turn2Usage.inputTokens || 0)
  const distinctKnowledgeDocuments = new Set(allSources.filter(source => source.sourceType !== 'web' && source.sourceType !== 'media').map(source => String(source.sourceId || source.sourceName || ''))).size

  const checks = {
    allTurnsCompleted: reports.every(turn => turn.completed !== null && turn.error === null && turn.answer.trim().length > 0),
    controllerRoute: reports.every(turn => turn.runtimeRoute === 'agent-controller-v2'),
    gemini38Preserved: reports.every(turn => String(turn.completed?.model || turn.turn?.response_model || '') === 'gemini-3.8-flash'),
    turn2ResolvedContinuity: turn2State.continuation === true && turn2Resolved.includes('yeşil enerji') && turn2Resolved.includes('teklifteki'),
    turn3ResolvedContinuity: turn3State.continuation === true && turn3Resolved.includes('yeşil enerji') && turn3Resolved.includes('sen bulcaksın'),
    turn3DelegationMove: ['follow_up','correction'].includes(String(turn3State.userMove || '')),
    knowledgeActuallySearched: allToolNames.some(name => ['search_knowledge_catalog','search_document','get_knowledge_object','get_message_detail','get_abap_source'].includes(name)),
    findsGreenMessage: sourceKeys.some(key => key === 'message:zcrm2-356'),
    findsOfferClass: sourceKeys.some(key => key === 'class:zcl_order_save_quotations'),
    noBroadCheckEnumeration: !reports.some(turn => turn.tools.some(tool => tool.tool_name === 'list_knowledge_catalog' && /^check_?$/iu.test(String((tool.arguments as FramePayload | undefined)?.prefix || '').trim()))),
    progressHasStart: progressCalls.some(tool => String((tool.arguments as FramePayload | undefined)?.kind || '') === 'start'),
    progressHasMeaningfulUpdate: progressCalls.some(tool => ['finding','plan_change'].includes(String((tool.arguments as FramePayload | undefined)?.kind || ''))),
    noGenericKnowledgeSpam: genericKnowledgeRows.length <= 1,
    noRollingSourceCountSpam: rollingCountRows.length === 0,
    doesNotAskDelegatedTechnicalRefAgain: !/(mesaj kodu|class|method|teknik referans).*(paylaş|ver|gönder|lazım|gerek)/iu.test(turn3Answer),
    distinctDocumentCountReasonable: distinctKnowledgeDocuments > 0 && distinctKnowledgeDocuments <= 6,
    providerCallImprovement: providerCalls > 0 && providerCalls < 9,
    tokenImprovement: inputTokens > 0 && inputTokens < 223000,
  }
  const passed = Object.values(checks).every(Boolean)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scenario: 'adaptive-green-energy-3-turn-continuity',
    workspaceId,
    model,
    target: new URL(stagingUrl).host,
    turns: reports,
    metrics: { providerCallsTurn2: providerCalls, inputTokensTurn2: inputTokens, distinctKnowledgeDocuments },
    checks,
    passed,
  }
  const outputIndex = args.indexOf('--output')
  const outputPath = resolve(outputIndex >= 0 && args[outputIndex + 1] ? args[outputIndex + 1] : 'evaluation/results/adaptive-green-energy-staging.json')
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  if (!passed) throw new Error(`ADAPTIVE_GREEN_STAGING_GATE_FAILED:${JSON.stringify(checks)}`)
} finally {
  await client.from('workspaces').delete().eq('id', workspaceId)
}
