import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { consumeSseBuffer } from '../src/services/sseParser'

const args = process.argv.slice(2)
if (!args.includes('--confirm-staging')) {
  throw new Error('Semantic-authority staging gate sends a real provider request. Re-run with --confirm-staging only against the isolated staging Supabase target.')
}

const requiredEnv = (name: string) => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required for the semantic-authority staging gate.`)
  return value
}

const normalizedBaseUrl = (value: string) => value.trim().replace(/\/+$/u, '').toLocaleLowerCase('en-US')
const stagingUrl = requiredEnv('AGENTIC_GOLDEN_STAGING_URL')
const productionUrl = requiredEnv('AGENTIC_GOLDEN_PRODUCTION_URL')
const anonKey = requiredEnv('AGENTIC_GOLDEN_ANON_KEY')
const accessToken = requiredEnv('AGENTIC_GOLDEN_ACCESS_TOKEN')
const workspaceId = requiredEnv('AGENTIC_GOLDEN_WORKSPACE_ID')
const model = String(process.env.AGENTIC_GOLDEN_MODEL || 'gemini-3.8-flash').trim() || 'gemini-3.8-flash'

if (normalizedBaseUrl(stagingUrl) === normalizedBaseUrl(productionUrl)) {
  throw new Error('AGENTIC_STAGING_PRODUCTION_TARGET_FORBIDDEN')
}

const message = 'İYS entegrasyon dokümanına ihtiyacım var güncel'
const messageId = `agentic-pr212-iys-${crypto.randomUUID()}`
const stagingClient = createClient(stagingUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: authData, error: authError } = await stagingClient.auth.getUser(accessToken)
if (authError || !authData.user || authData.user.is_anonymous) {
  throw new Error(`Semantic-authority staging gate requires the permanent staging user: ${authError?.message || 'no permanent user'}`)
}

const { data: workspace, error: workspaceError } = await stagingClient
  .from('workspaces')
  .select('id')
  .eq('id', workspaceId)
  .maybeSingle()
if (workspaceError || !workspace) {
  throw new Error(`Semantic-authority staging workspace is unavailable: ${workspaceError?.message || workspaceId}`)
}

const { error: messageError } = await stagingClient.from('messages').insert({
  id: messageId,
  workspace_id: workspaceId,
  sender_name: authData.user.email?.split('@')[0] || 'Agentic Golden User',
  sender_role: 'Kullanıcı',
  text: message,
  is_ai: false,
  attachments: [],
  reactions: [],
  role: 'user',
  owner_id: authData.user.id,
})
if (messageError) throw new Error(`Semantic-authority staging user message could not be persisted: ${messageError.message}`)

const startedAt = performance.now()
const response = await fetch(`${normalizedBaseUrl(stagingUrl)}/functions/v1/openai-assistant-v2`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
    'x-client-info': 'jetwork-agentic-semantic-authority-staging-gate/1',
  },
  body: JSON.stringify({
    workspaceId,
    messageId,
    message,
    model,
    workMode: 'balanced',
    chatAttachments: [],
  }),
})
const headersAt = performance.now()
const runtimeRoute = response.headers.get('x-jetwork-runtime-route') || ''
if (!response.ok) {
  const detail = await response.text().catch(() => '')
  throw new Error(`SEMANTIC_AUTHORITY_STAGING_HTTP_${response.status}:${detail.slice(0, 1000)}`)
}
if (!response.body) throw new Error('SEMANTIC_AUTHORITY_STAGING_EMPTY_STREAM')

let fullText = ''
let completedPayload: Record<string, unknown> | null = null
let errorPayload: Record<string, unknown> | null = null
const statuses: Array<Record<string, unknown>> = []
const sourceMap = new Map<string, Record<string, unknown>>()
let firstTextAt: number | null = null

const handleFrame = (event: { event?: string; data: string }) => {
  if (event.data === '[DONE]') return
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(event.data)
    if (!parsed || typeof parsed !== 'object') return
    payload = parsed as Record<string, unknown>
  } catch {
    return
  }
  const type = String(event.event || payload.type || '')
  if (type === 'text_delta') {
    const delta = String(payload.delta || '')
    fullText += delta
    if (firstTextAt === null && delta.trim()) firstTextAt = performance.now()
    return
  }
  if (type === 'status') {
    statuses.push(payload)
    return
  }
  if (type === 'sources') {
    const sources = Array.isArray(payload.sources) ? payload.sources : []
    for (const raw of sources) {
      if (!raw || typeof raw !== 'object') continue
      const source = raw as Record<string, unknown>
      const key = [source.sourceType, source.sourceId, source.canonicalKey, source.url, source.sourceName].map(value => String(value || '')).join('|')
      sourceMap.set(key, source)
    }
    return
  }
  if (type === 'completed') {
    completedPayload = payload
    return
  }
  if (type === 'error') errorPayload = payload
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
  parsed.events.forEach(handleFrame)
}
buffer += decoder.decode()
consumeSseBuffer(buffer, true).events.forEach(handleFrame)
const completedAt = performance.now()

const sources = [...sourceMap.values()]
const webSources = sources.filter(source => (
  source.sourceType === 'web'
  && /^https:\/\//iu.test(String(source.url || ''))
))
const genericGroundingFailure = /^Bu teknik yanıtı güvenli biçimde tamamlayamadım:/u.test(fullText.trim())
const checks = {
  completionEvent: completedPayload !== null,
  noErrorEvent: errorPayload === null,
  controllerRoute: runtimeRoute === 'agent-controller-v2',
  controllerMode: completedPayload?.controllerMode === true,
  explicitGemini38Preserved: String(completedPayload?.model || '') === 'gemini-3.8-flash',
  userVisibleAnswer: fullText.trim().length > 0,
  webSelectedByController: webSources.length > 0,
  noPrematureGenericGroundingFailure: !genericGroundingFailure,
}
const passed = Object.values(checks).every(Boolean)

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scenario: 'agent-v2-05-current-web-decision',
  message,
  messageId,
  model,
  target: new URL(stagingUrl).host,
  runtimeRoute,
  completed: completedPayload,
  error: errorPayload,
  statuses,
  sources: sources.map(source => ({
    sourceType: source.sourceType,
    sourceName: source.sourceName,
    title: source.title,
    url: source.url,
    canonicalKey: source.canonicalKey,
  })),
  answer: fullText,
  timing: {
    headersMs: Math.max(0, Math.round(headersAt - startedAt)),
    ttftMs: firstTextAt === null ? null : Math.max(0, Math.round(firstTextAt - startedAt)),
    totalMs: Math.max(0, Math.round(completedAt - startedAt)),
  },
  checks,
  passed,
}

const outputArgIndex = args.indexOf('--output')
const outputPath = resolve(
  outputArgIndex >= 0 && args[outputArgIndex + 1]
    ? args[outputArgIndex + 1]
    : 'evaluation/results/agentic-semantic-authority-staging.json',
)
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))

if (!passed) {
  throw new Error(`SEMANTIC_AUTHORITY_STAGING_GATE_FAILED:${JSON.stringify(checks)}`)
}
