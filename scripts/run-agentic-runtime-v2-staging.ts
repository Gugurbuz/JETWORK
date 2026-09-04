import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { runAgenticRuntimeStagingProbeSuite } from '../src/evaluation/agenticRuntimeStagingSuite'

const args = process.argv.slice(2)
if (!args.includes('--confirm-staging')) {
  throw new Error('Agentic staging probe sends real provider requests. Re-run with --confirm-staging after selecting a non-production Supabase target.')
}

const requiredEnv = (name: string) => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required for the Agentic Runtime staging probe.`)
  return value
}

const normalizedBaseUrl = (value: string) => String(value || '').trim().replace(/\/+$/u, '').toLocaleLowerCase('en-US')
const stagingUrl = requiredEnv('AGENTIC_GOLDEN_STAGING_URL')
const productionUrl = requiredEnv('AGENTIC_GOLDEN_PRODUCTION_URL')
const anonKey = requiredEnv('AGENTIC_GOLDEN_ANON_KEY')
const accessToken = requiredEnv('AGENTIC_GOLDEN_ACCESS_TOKEN')
const workspaceId = requiredEnv('AGENTIC_GOLDEN_WORKSPACE_ID')
const model = String(process.env.AGENTIC_GOLDEN_MODEL || 'auto').trim() || 'auto'

// Fail before any authenticated database write. The lower-level SSE probe repeats
// the same guard, but the CLI must protect its beforeTurn message persistence too.
if (normalizedBaseUrl(stagingUrl) === normalizedBaseUrl(productionUrl)) {
  throw new Error('AGENTIC_STAGING_PRODUCTION_TARGET_FORBIDDEN')
}

const stagingClient = createClient(stagingUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: authData, error: authError } = await stagingClient.auth.getUser(accessToken)
if (authError || !authData.user || authData.user.is_anonymous) {
  throw new Error(`Agentic staging probe requires a valid permanent staging user: ${authError?.message || 'no user'}`)
}

const { data: workspace, error: workspaceError } = await stagingClient
  .from('workspaces')
  .select('id')
  .eq('id', workspaceId)
  .maybeSingle()
if (workspaceError || !workspace) {
  throw new Error(`Agentic staging workspace is unavailable: ${workspaceError?.message || workspaceId}`)
}

const persistGoldenUserMessage = async (input: { messageId: string; message: string }) => {
  const { error } = await stagingClient.from('messages').insert({
    id: input.messageId,
    workspace_id: workspaceId,
    sender_name: authData.user.email?.split('@')[0] || 'Agentic Golden User',
    sender_role: 'Kullanıcı',
    text: input.message,
    is_ai: false,
    attachments: [],
    reactions: [],
    created_at: new Date().toISOString(),
    role: 'user',
    owner_id: authData.user.id,
  })
  if (error) throw new Error(`Agentic staging user message could not be persisted: ${error.message}`)
}

const outputArgIndex = args.indexOf('--output')
const outputPath = resolve(
  outputArgIndex >= 0 && args[outputArgIndex + 1]
    ? args[outputArgIndex + 1]
    : 'evaluation/results/agentic-runtime-v2-staging-performance.json',
)

const startedAt = new Date().toISOString()
const suite = await runAgenticRuntimeStagingProbeSuite({
  targetSupabaseUrl: stagingUrl,
  productionSupabaseUrl: productionUrl,
  anonKey,
  accessToken,
  workspaceId,
  model,
  beforeTurn: async ({ messageId, message }) => {
    await persistGoldenUserMessage({ messageId, message })
  },
})
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  startedAt,
  model,
  target: new URL(stagingUrl).host,
  ...suite,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`Agentic Runtime staging performance baseline saved to ${outputPath}`)
console.log(JSON.stringify(report.performance, null, 2))
console.log('This report is performance-only. P6 semantic quality/release gates must be evaluated separately.')
