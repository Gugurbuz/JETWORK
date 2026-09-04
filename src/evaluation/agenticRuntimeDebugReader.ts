import type { AgenticRuntimeTelemetryInput, RuntimeToolTraceRow } from './agenticRuntimeTraceAdapter'

export const AGENTIC_RUNTIME_DEBUG_READER_VERSION = 'agentic-runtime-debug-reader-v1'

export interface AgenticRuntimeRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>
}

export interface AgenticRuntimeDebugReadResult {
  version: typeof AGENTIC_RUNTIME_DEBUG_READER_VERSION
  runId: string
  telemetry: AgenticRuntimeTelemetryInput
  usage: Record<string, number>
  latencyMs: number | null
  toolCallCount: number
  responseModel?: string
  provider?: string
  rawDetail: Record<string, unknown>
}

const clean = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)
const finite = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
const object = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)
const numericUsage = (value: unknown) => Object.fromEntries(
  Object.entries(object(value)).flatMap(([key, candidate]) => {
    const number = finite(candidate)
    return number === null ? [] : [[key, number] as const]
  }),
)

const mapToolRun = (raw: unknown): RuntimeToolTraceRow | null => {
  const row = object(raw)
  const toolName = clean(row.toolName || row.tool_name, 120)
  const status = clean(row.status, 40)
  if (!toolName || (status !== 'completed' && status !== 'failed')) return null
  const summary = object(row.resultSummary || row.result_summary)
  return {
    toolName,
    status,
    selectedByController: typeof summary.selectedByController === 'boolean'
      ? summary.selectedByController
      : undefined,
    summary,
  }
}

/**
 * Reads the authenticated owner's reasoning telemetry for one staging message.
 * This is a mechanical telemetry adapter only: it does not manufacture judge
 * assertions or infer forbidden semantic behavior from answer text.
 */
export async function readAgenticRuntimeDebugTelemetry(input: {
  client: AgenticRuntimeRpcClient
  workspaceId: string
  messageId: string
  listLimit?: number
}): Promise<AgenticRuntimeDebugReadResult> {
  const workspaceId = clean(input.workspaceId, 200)
  const messageId = clean(input.messageId, 240)
  if (!workspaceId || !messageId) throw new Error('AGENTIC_DEBUG_LOOKUP_INPUT_REQUIRED')

  const { data: runs, error: runsError } = await input.client.rpc('get_reasoning_debug_runs', {
    p_workspace_id: workspaceId,
    p_limit: Math.max(1, Math.min(Math.trunc(input.listLimit || 24), 100)),
    p_offset: 0,
  })
  if (runsError) throw new Error(`AGENTIC_DEBUG_RUNS_UNAVAILABLE:${clean(runsError.message, 1_000)}`)
  const run = (Array.isArray(runs) ? runs : []).find((candidate: any) => clean(candidate?.message_id, 240) === messageId)
  const runId = clean(run?.run_id, 200)
  if (!runId) throw new Error(`AGENTIC_DEBUG_RUN_NOT_FOUND:${messageId}`)

  const { data: detailData, error: detailError } = await input.client.rpc('get_reasoning_debug_run', {
    p_run_id: runId,
  })
  if (detailError || !detailData) {
    throw new Error(`AGENTIC_DEBUG_DETAIL_UNAVAILABLE:${clean(detailError?.message || runId, 1_000)}`)
  }
  const detail = object(detailData)
  const toolRuns = (Array.isArray(detail.toolRuns) ? detail.toolRuns : [])
    .map(mapToolRun)
    .filter((row): row is RuntimeToolTraceRow => row !== null)
  const evidenceSummary = object(detail.evidenceSummary)
  const usage = numericUsage(detail.usage)

  return {
    version: AGENTIC_RUNTIME_DEBUG_READER_VERSION,
    runId,
    telemetry: {
      completed: clean(detail.status, 40) === 'completed',
      toolRuns,
      evidenceSummary,
      judgeAssertions: [],
      observedBehaviors: [],
    },
    usage,
    latencyMs: finite(detail.latencyMs),
    toolCallCount: Math.trunc(finite(detail.toolCallCount) || toolRuns.length),
    responseModel: clean(detail.responseModel, 120) || undefined,
    provider: clean(detail.provider, 40) || undefined,
    rawDetail: detail,
  }
}
