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

const stagingUrl = requiredEnv('AGENTIC_GOLDEN_STAGING_URL')
const productionUrl = requiredEnv('AGENTIC_GOLDEN_PRODUCTION_URL')
const anonKey = requiredEnv('AGENTIC_GOLDEN_ANON_KEY')
const accessToken = requiredEnv('AGENTIC_GOLDEN_ACCESS_TOKEN')
const workspaceId = requiredEnv('AGENTIC_GOLDEN_WORKSPACE_ID')
const model = String(process.env.AGENTIC_GOLDEN_MODEL || 'auto').trim() || 'auto'

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
