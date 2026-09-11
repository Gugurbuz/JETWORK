import { createClient } from '@supabase/supabase-js'
// benchmark trigger: verified-evidence finalizer + canonical dedupe + literal provenance recovery
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const env = process.env
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://bpbbvjigostgrssnduhk.supabase.co'
const anonKey = env.VITE_SUPABASE_ANON_KEY || ''
const username = env.E2E_USERNAME || ''
const password = env.E2E_PASSWORD || ''
const endpoint = env.ASSISTANT_COST_ENDPOINT || 'assistant-primary-agent-core-canary'
const model = env.ASSISTANT_COST_MODEL || 'gemini-3.8-flash'
const outputPath = resolve(env.ASSISTANT_COST_OUTPUT || 'evaluation/results/assistant-cost-regression.json')

if (!anonKey || !username || !password) {
  throw new Error('Cost benchmark requires VITE_SUPABASE_ANON_KEY, E2E_USERNAME and E2E_PASSWORD.')
}

type Scenario = {
  key: string
  group: string
  step: number
  prompt: string
  checks: Array<(answer: string, usage: Record<string, number>, sources: Array<Record<string, unknown>>) => string | null>
}

const normalized = (value: string) => value.normalize('NFKC').toLocaleUpperCase('en-US')
const contains = (needle: string) => (answer: string) =>
  normalized(answer).includes(normalized(needle)) ? null : `missing:${needle}`
const notContains = (needle: string) => (answer: string) =>
  normalized(answer).includes(normalized(needle)) ? `unexpected:${needle}` : null
const regex = (pattern: RegExp) => (answer: string) => pattern.test(answer) ? null : `regex:${pattern.source}`
const nonempty = (answer: string) => answer.trim() ? null : 'empty_response'
const sourceCanonical = (canonicalKey: string) => (_answer: string, _usage: Record<string, number>, sources: Array<Record<string, unknown>>) =>
  sources.some(source => String(source.canonicalKey || '') === canonicalKey) ? null : `missing_source:${canonicalKey}`

const scenarios: Scenario[] = [
  {
    key: 'simple_answer',
    group: 'simple_answer',
    step: 1,
    prompt: 'Merhaba. Lütfen yalnızca iki kısa cümleyle yanıt ver.',
    checks: [nonempty, notContains('OpenAI API kullanım kredisi'), notContains('Yanıt tamamlanamadı')],
  },
  {
    key: 'real_abap_111',
    group: 'real_abap_111',
    step: 1,
    prompt: '111 nolu hatanın abap kodunu ver',
    checks: [contains('ZCRM_COST-111'), contains('MESSAGE e111(zcrm_cost)'), sourceCanonical('message:zcrm_cost-111')],
  },
  {
    key: 'check_ztks_first',
    group: 'check_ztks',
    step: 1,
    prompt: 'CHECK_ZTKS hangi mesajları üretiyor?',
    checks: [contains('ZCRM2-544'), contains('ZCRM2-545'), contains('ZCRM2-586')],
  },
  {
    key: 'check_ztks_followup',
    group: 'check_ztks',
    step: 2,
    prompt: 'Peki hangi fonksiyonu çağırıyor?',
    checks: [contains('Z_FICA_TKS_CHECK')],
  },
  {
    key: 'implementation_absent',
    group: 'implementation_absent',
    step: 1,
    prompt: 'GET_SATILABILIR_LIMIT metodunun tam ABAP implementasyon kodunu ver',
    checks: [contains('get_satilabilir_limit'), regex(/implementasyon kaynağı|tam implementasyon|mevcut değil|bulunmuyor|yer almamaktadır|yer almıyor/iu)],
  },
]

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const resolveEmail = async (input: string) => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return input
  const { data, error } = await supabase.rpc('resolve_login_email', { p_username: input })
  if (error || !data) throw new Error(`Benchmark username could not be resolved: ${error?.message || input}`)
  return String(data)
}

const createWorkspace = async (user: { id: string; email?: string | null }, label: string) => {
  const projectId = randomUUID()
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  const { error: projectError } = await supabase.from('projects').insert({
    id: projectId,
    name: `PR278 Cost ${label}`,
    description: 'Isolated PR #278 cost regression benchmark',
    owner_id: user.id,
    created_at: now,
    last_updated: now,
  })
  if (projectError) throw projectError
  const { error: workspaceError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    project_id: projectId,
    issue_key: `COST-${workspaceId.slice(0, 4).toUpperCase()}`,
    title: `PR278 Cost ${label}`,
    type: 'Development',
    status: 'Draft',
    owner_id: user.id,
    collaborators: [{
      id: user.id,
      name: user.email?.split('@')[0] || 'Cost Benchmark',
      email: user.email || null,
      role: 'Kurucu',
      color: '#4f46e5',
    }],
    created_at: now,
    last_updated: now,
  })
  if (workspaceError) {
    await supabase.from('projects').delete().eq('id', projectId)
    throw workspaceError
  }
  return { projectId, workspaceId }
}

const cleanupWorkspace = async (projectId: string, workspaceId: string) => {
  await supabase.from('workspaces').delete().eq('id', workspaceId)
  await supabase.from('projects').delete().eq('id', projectId)
}

type ParsedStream = {
  answer: string
  completed: boolean
  error: string | null
  provider: string | null
  model: string | null
  usage: Record<string, number>
  sources: Array<Record<string, unknown>>
  firstTextMs: number | null
  totalMs: number
}

const readSse = async (response: Response, startedAt: number): Promise<ParsedStream> => {
  if (!response.body) throw new Error('Canary returned an empty stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let completed = false
  let error: string | null = null
  let provider: string | null = null
  let responseModel: string | null = null
  let firstTextMs: number | null = null
  let completedUsage: Record<string, number> = {}
  const sources: Array<Record<string, unknown>> = []

  const consume = (frame: string) => {
    const dataLines = frame.split(/\r?\n/u)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    if (raw === '[DONE]') return
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>
      const type = String(payload.type || '')
      if (type === 'text_delta') {
        if (firstTextMs === null) firstTextMs = Date.now() - startedAt
        answer += String(payload.delta || '')
      }
      if (type === 'sources' && Array.isArray(payload.sources)) {
        for (const source of payload.sources) {
          if (source && typeof source === 'object') sources.push(source as Record<string, unknown>)
        }
      }
      if (type === 'completed') {
        completed = true
        provider = payload.provider ? String(payload.provider) : provider
        responseModel = payload.model ? String(payload.model) : responseModel
        if (payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)) {
          completedUsage = Object.fromEntries(
            Object.entries(payload.usage as Record<string, unknown>)
              .map(([key, value]) => [key, Number(value)])
              .filter(([, value]) => Number.isFinite(value)),
          ) as Record<string, number>
        }
      }
      if (type === 'error') error = String(payload.message || 'runtime error')
    } catch { /* ignore non-JSON frames */ }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/u)
    buffer = frames.pop() || ''
    for (const frame of frames) consume(frame)
  }
  buffer += decoder.decode()
  if (buffer.trim()) consume(buffer)

  return {
    answer,
    completed,
    error,
    provider,
    model: responseModel,
    usage: completedUsage,
    sources,
    firstTextMs,
    totalMs: Date.now() - startedAt,
  }
}

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0

const email = await resolveEmail(username)
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
if (authError || !authData.session || !authData.user) {
  throw new Error(`Benchmark login failed: ${authError?.message || 'no session'}`)
}

const workspaces = new Map<string, { projectId: string; workspaceId: string }>()
const results: any[] = []

try {
  for (const scenario of scenarios) {
    let workspace = workspaces.get(scenario.group)
    if (!workspace) {
      workspace = await createWorkspace(authData.user, scenario.group)
      workspaces.set(scenario.group, workspace)
    }

    const messageId = randomUUID()
    const createdAt = new Date().toISOString()
    const { error: messageError } = await supabase.from('messages').insert({
      id: messageId,
      workspace_id: workspace.workspaceId,
      sender_name: authData.user.email?.split('@')[0] || 'Cost Benchmark',
      sender_role: 'Kullanıcı',
      text: scenario.prompt,
      is_ai: false,
      role: 'user',
      owner_id: authData.user.id,
      attachments: [],
      reactions: [],
      grounding_urls: [],
      questions: [],
      created_at: createdAt,
    })
    if (messageError) throw new Error(`${scenario.key}: message persist failed: ${messageError.message}`)

    const startedAt = Date.now()
    const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        workspaceId: workspace.workspaceId,
        messageId,
        message: scenario.prompt,
        model,
        chatAttachments: [],
      }),
    })
    if (!response.ok) {
      throw new Error(`${scenario.key}: endpoint ${response.status}: ${(await response.text()).slice(0, 800)}`)
    }

    const stream = await readSse(response, startedAt)
    const usage = stream.usage
    const sources = stream.sources
    const answer = String(stream.answer || '')
    const failures = scenario.checks
      .map(check => check(answer, usage, sources))
      .filter((failure): failure is string => Boolean(failure))
    if (stream.error) failures.push(`runtime_error:${stream.error}`)
    if (!stream.completed) failures.push('stream_not_completed')

    const inputTokens = asNumber(usage.input_tokens)
    const cachedTokens = asNumber(usage.cached_tokens)
    results.push({
      key: scenario.key,
      group: scenario.group,
      step: scenario.step,
      prompt: scenario.prompt,
      status: stream.completed ? 'completed' : 'unknown',
      model: stream.model,
      provider: stream.provider || 'gemini',
      firstTextMs: stream.firstTextMs,
      totalMs: stream.totalMs,
      inputTokens,
      cachedTokens,
      uncachedInputTokens: Math.max(0, inputTokens - cachedTokens),
      outputTokens: asNumber(usage.output_tokens),
      reasoningTokens: asNumber(usage.reasoning_tokens),
      providerCalls: asNumber(usage.gemini_interactions_api_calls),
      estimatedCostUsd: asNumber(usage.estimated_cost_usd),
      payloadCharacters: {
        productCore: asNumber(usage.provider_product_core_chars),
        controllerCore: asNumber(usage.provider_controller_core_chars),
        runtimeObservation: asNumber(usage.provider_runtime_observation_chars),
        publicWork: asNumber(usage.provider_public_work_chars),
        systemInstruction: asNumber(usage.provider_system_instruction_chars),
        toolSchemas: asNumber(usage.provider_tool_schema_chars),
        items: asNumber(usage.provider_item_chars),
      },
      observationCharacters: {
        full: asNumber(usage.semantic_action_batch_observation_full_characters) + asNumber(usage.direct_observation_full_characters),
        preview: asNumber(usage.semantic_action_batch_observation_preview_characters) + asNumber(usage.direct_observation_preview_characters),
        contentRead: asNumber(usage.observation_content_returned_characters),
      },
      qualityPassed: failures.length === 0 && stream.completed,
      qualityFailures: failures,
      answerPreview: answer.slice(0, 900),
      sources: sources.map(source => ({
        canonicalKey: source.canonicalKey || null,
        title: source.title || null,
        sourceType: source.sourceType || null,
      })).slice(0, 12),
      usage,
    })

    await new Promise(resolve => setTimeout(resolve, 250))
  }
} finally {
  for (const workspace of workspaces.values()) {
    await cleanupWorkspace(workspace.projectId, workspace.workspaceId)
  }
}

const total = (field: string) => results.reduce((sum, result) => sum + asNumber(result[field]), 0)
const totalInputTokens = total('inputTokens')
const totalCachedTokens = total('cachedTokens')
const totalUncachedInputTokens = total('uncachedInputTokens')
const totalProviderCalls = total('providerCalls')
const qualityPassed = results.every(result => result.qualityPassed)
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  endpoint,
  model,
  candidateSha: process.env.GITHUB_SHA || 'local',
  baseline: {
    inputTokens: 318515,
    cachedTokens: 40252,
    uncachedInputTokens: 278263,
    providerCalls: 18,
  },
  targets: {
    productionInputTokensMax: 45000,
    productionUncachedInputTokensMax: 20000,
    checkpointInputTokensMax: 60000,
  },
  summary: {
    scenarioCount: results.length,
    qualityPassed,
    inputTokens: totalInputTokens,
    cachedTokens: totalCachedTokens,
    uncachedInputTokens: totalUncachedInputTokens,
    outputTokens: total('outputTokens'),
    reasoningTokens: total('reasoningTokens'),
    providerCalls: totalProviderCalls,
    estimatedCostUsd: results.reduce((sum, result) => sum + asNumber(result.estimatedCostUsd), 0),
    rawInputReductionPct: Number(((1 - totalInputTokens / 318515) * 100).toFixed(2)),
    uncachedInputReductionPct: Number(((1 - totalUncachedInputTokens / 278263) * 100).toFixed(2)),
    passesProductionRawGate: totalInputTokens <= 45000,
    passesProductionUncachedGate: totalUncachedInputTokens <= 20000,
    passesCheckpointRawGate: totalInputTokens <= 60000,
  },
  scenarios: results,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log('\nPR #278 cost regression')
console.table(results.map(result => ({
  scenario: result.key,
  quality: result.qualityPassed ? 'PASS' : 'FAIL',
  input: result.inputTokens,
  cached: result.cachedTokens,
  uncached: result.uncachedInputTokens,
  calls: result.providerCalls,
  firstTextMs: result.firstTextMs,
  totalMs: result.totalMs,
})))
console.log(JSON.stringify(report.summary, null, 2))

if (!qualityPassed) throw new Error('Cost regression failed: at least one scenario failed its quality contract.')
