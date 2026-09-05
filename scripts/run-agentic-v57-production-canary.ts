import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const env = process.env
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://bpbbvjigostgrssnduhk.supabase.co'
const anonKey = env.VITE_SUPABASE_ANON_KEY || ''
const username = env.E2E_USERNAME || ''
const password = env.E2E_PASSWORD || ''
const endpoint = env.REASONING_CANARY_ENDPOINT || 'openai-assistant-v2'
const model = 'auto'

if (!anonKey || !username || !password) {
  throw new Error('Agentic v57 production canary requires VITE_SUPABASE_ANON_KEY, E2E_USERNAME and E2E_PASSWORD.')
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const resolveEmail = async (input: string) => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return input
  const { data, error } = await supabase.rpc('resolve_login_email', { p_username: input })
  if (error || !data) throw new Error(`Canary username could not be resolved: ${error?.message || input}`)
  return String(data)
}

interface ParsedEvent {
  event: string
  payload: Record<string, unknown>
}

const parseSse = (raw: string): ParsedEvent[] => raw
  .split(/\r?\n\r?\n/)
  .map(block => block.trim())
  .filter(Boolean)
  .flatMap(block => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!dataLines.length) return []
    const data = dataLines.join('\n')
    if (data === '[DONE]') return [{ event: 'done', payload: {} }]
    try {
      const payload = JSON.parse(data)
      return payload && typeof payload === 'object'
        ? [{ event, payload: payload as Record<string, unknown> }]
        : []
    } catch {
      return []
    }
  })

const createWorkspace = async (user: { id: string; email?: string | null }) => {
  const projectId = randomUUID()
  const workspaceId = randomUUID()
  const timestamp = new Date().toISOString()
  const { error: projectError } = await supabase.from('projects').insert({
    id: projectId,
    name: 'Agentic v57 Multi Artifact Acceptance',
    description: 'Production acceptance: shared research -> verified DOCX + XLSX',
    owner_id: user.id,
    created_at: timestamp,
    last_updated: timestamp,
  })
  if (projectError) throw projectError

  const { error: workspaceError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    project_id: projectId,
    issue_key: `V57-${workspaceId.slice(0, 5).toUpperCase()}`,
    title: '[Acceptance] Agentic v57 Multi Artifact',
    type: 'Support',
    status: 'Draft',
    owner_id: user.id,
    collaborators: [{
      id: user.id,
      name: user.email?.split('@')[0] || 'Production Canary',
      email: user.email || null,
      role: 'Kurucu',
      color: '#4f46e5',
    }],
    created_at: timestamp,
    last_updated: timestamp,
  })
  if (workspaceError) throw workspaceError
  return { projectId, workspaceId }
}

const persistUserMessage = async (input: { id: string; workspaceId: string; ownerId: string; text: string }) => {
  const { error } = await supabase.from('messages').insert({
    id: input.id,
    workspace_id: input.workspaceId,
    sender_name: 'Production Canary',
    sender_role: 'Kullanıcı',
    text: input.text,
    is_ai: false,
    attachments: [],
    reactions: [],
    created_at: new Date().toISOString(),
    role: 'user',
    owner_id: input.ownerId,
  })
  if (error) throw new Error(`Canary message could not be persisted: ${error.message}`)
}

const callAssistant = async (input: { token: string; userId: string; workspaceId: string; message: string }) => {
  const messageId = randomUUID()
  await persistUserMessage({ id: messageId, workspaceId: input.workspaceId, ownerId: input.userId, text: input.message })

  const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      messageId,
      message: input.message,
      model,
      chatAttachments: [],
    }),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Canary endpoint ${response.status}: ${raw.slice(0, 2_000)}`)

  const events = parseSse(raw)
  let answer = ''
  let completed = false
  let errorMessage = ''
  let responseModel = ''
  for (const item of events) {
    const type = String(item.payload.type || item.event || '')
    if (type === 'text_delta') answer += String(item.payload.delta || '')
    if (type === 'completed') {
      completed = true
      responseModel = String(item.payload.model || '')
    }
    if (type === 'error') errorMessage = String(item.payload.message || 'runtime error')
  }
  if (!completed || errorMessage || !answer.trim()) {
    throw new Error(`Turn failed: completed=${completed}, error=${errorMessage || 'none'}, answerLength=${answer.length}`)
  }
  return { messageId, answer, responseModel }
}

const readReasoningDetail = async (workspaceId: string, messageId: string) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data: runs, error: runsError } = await supabase.rpc('get_reasoning_debug_runs', {
      p_workspace_id: workspaceId,
      p_limit: 12,
      p_offset: 0,
    })
    if (runsError) throw new Error(`Reasoning runs unavailable: ${runsError.message}`)
    const run = (runs || []).find((candidate: any) => String(candidate.message_id || '') === messageId)
    if (run?.run_id) {
      const { data: detail, error: detailError } = await supabase.rpc('get_reasoning_debug_run', { p_run_id: run.run_id })
      if (detailError) throw new Error(`Reasoning detail unavailable: ${detailError.message}`)
      if (detail) return detail as Record<string, any>
    }
    await sleep(1_000)
  }
  throw new Error(`No reasoning detail found for ${messageId}`)
}

const assertAcceptance = (detail: Record<string, any>) => {
  if (detail.status !== 'completed') throw new Error(`Expected completed turn, got ${String(detail.status)}`)
  const tools = Array.isArray(detail.toolRuns) ? detail.toolRuns : []
  const research = tools.filter((tool: any) => tool.toolName === 'research_knowledge')
  const artifacts = tools.filter((tool: any) => tool.toolName === 'create_artifact_bundle')

  if (research.length !== 1) throw new Error(`Expected exactly 1 research_knowledge, got ${research.length}`)
  if (research[0]?.status !== 'completed') throw new Error(`research_knowledge status=${String(research[0]?.status)}`)
  const researchSummary = research[0]?.resultSummary || {}
  if (Number(researchSummary.searchCalls || 0) !== 0) throw new Error(`Expected searchCalls=0, got ${String(researchSummary.searchCalls)}`)
  if (researchSummary.mechanicalCoverageComplete !== true) throw new Error('mechanicalCoverageComplete is not true')
  if (Number(researchSummary.requestedExactTargetCount || 0) !== 2) throw new Error(`Expected requestedExactTargetCount=2, got ${String(researchSummary.requestedExactTargetCount)}`)
  if (Number(researchSummary.resolvedExactTargetCount || 0) !== 2) throw new Error(`Expected resolvedExactTargetCount=2, got ${String(researchSummary.resolvedExactTargetCount)}`)

  if (artifacts.length !== 1) throw new Error(`Expected exactly 1 create_artifact_bundle, got ${artifacts.length}`)
  if (artifacts[0]?.status !== 'completed') throw new Error(`create_artifact_bundle status=${String(artifacts[0]?.status)} error=${String(artifacts[0]?.errorMessage || '')}`)
  const artifactSummary = artifacts[0]?.resultSummary || {}
  if (Number(artifactSummary.artifactCount || 0) !== 2) throw new Error(`Expected artifactCount=2, got ${String(artifactSummary.artifactCount)}`)
  if (Number(artifactSummary.requestedCount || 0) !== 2) throw new Error(`Expected requestedCount=2, got ${String(artifactSummary.requestedCount)}`)
  if (artifactSummary.allOutputsVerified !== true) throw new Error('allOutputsVerified is not true')
  if (artifactSummary.artifactGroundingVerified !== true) throw new Error('artifactGroundingVerified is not true')
  const formats = Array.isArray(artifactSummary.formats) ? artifactSummary.formats.map(String).sort() : []
  if (formats.join(',') !== 'docx,xlsx') throw new Error(`Expected formats docx,xlsx, got ${formats.join(',')}`)

  const artifactPayload = JSON.stringify(artifacts[0]?.arguments || {}).toLocaleUpperCase('en-US')
  const forbidden = ['ZCRM2-330', 'ZBIL_CRM_KACAK_POD_KONT', 'SAGILE-957']
  for (const value of forbidden) if (artifactPayload.includes(value)) throw new Error(`Forbidden unsupported artifact identifier present: ${value}`)
  const required = ['ZCRM2-329', 'ZBIL_CRM_FATURADAR_KONT', 'ZCRM2-338', 'ZBIL_CS_POD_OPERAND']
  for (const value of required) if (!artifactPayload.includes(value)) throw new Error(`Required verified artifact identifier missing: ${value}`)

  return {
    researchSummary,
    artifactSummary,
    toolNames: tools.map((tool: any) => tool.toolName),
  }
}

const email = await resolveEmail(username)
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
if (authError || !authData.session || !authData.user) {
  throw new Error(`Production canary login failed: ${authError?.message || 'no session'}`)
}

const { workspaceId } = await createWorkspace(authData.user)
const prompt = 'ZCL_ORDER_SAVE_QUOTATIONS/CHECK_FATURADAR ile ZCL_ORDER_SAVE_QUOTATIONS/CHECK_KACAK_POD metotları arasındaki teknik farkları kaynaklardan incele. Sonucu Word dokümanı olarak ver. Bulduğun teknik bulguları ayrıca Excel dosyasında listele. Word ve Excel aynı doğrulanmış analizden üretilsin.'

console.log(`Acceptance workspace=${workspaceId}`)
const turn = await callAssistant({
  token: authData.session.access_token,
  userId: authData.user.id,
  workspaceId,
  message: prompt,
})
const detail = await readReasoningDetail(workspaceId, turn.messageId)
const accepted = assertAcceptance(detail)

console.log(JSON.stringify({
  ok: true,
  workspaceId,
  messageId: turn.messageId,
  responseModel: turn.responseModel,
  engineVersion: detail.engineVersion,
  status: detail.status,
  toolCallCount: detail.toolCallCount,
  researchToolCalls: 1,
  artifactBundleCalls: 1,
  artifactCount: accepted.artifactSummary.artifactCount,
  formats: accepted.artifactSummary.formats,
  allOutputsVerified: accepted.artifactSummary.allOutputsVerified,
  artifactGroundingVerified: accepted.artifactSummary.artifactGroundingVerified,
  requestedExactTargetCount: accepted.researchSummary.requestedExactTargetCount,
  resolvedExactTargetCount: accepted.researchSummary.resolvedExactTargetCount,
  searchCalls: accepted.researchSummary.searchCalls,
  toolNames: accepted.toolNames,
}, null, 2))
