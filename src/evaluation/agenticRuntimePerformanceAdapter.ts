import type { AgenticRuntimeRunMetrics } from './agenticRuntimeV2Scorecard'

export const AGENTIC_RUNTIME_PERFORMANCE_ADAPTER_VERSION = 'agentic-runtime-performance-adapter-v1'

type PerformanceMetricKeys =
  | 'controllerRounds'
  | 'toolCalls'
  | 'providerCalls'
  | 'ttftMs'
  | 'streamOpenToFirstTextMs'
  | 'totalLatencyMs'
  | 'inputTokens'
  | 'outputTokens'
  | 'costUsd'

export type AgenticRuntimeMechanicalPerformance = Pick<AgenticRuntimeRunMetrics, PerformanceMetricKeys>

export interface AgenticRuntimeMechanicalTelemetryInput {
  controllerRounds?: number | null
  toolCalls?: number | null
  providerCalls?: number | null
  endToEndTtftMs?: number | null
  streamOpenToFirstTextMs?: number | null
  totalLatencyMs?: number | null
  usage?: Record<string, unknown> | null
}

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const integerOrNull = (value: unknown) => {
  const parsed = finite(value)
  return parsed === null ? null : Math.max(0, Math.trunc(parsed))
}

const firstFinite = (usage: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) {
    const value = finite(usage[key])
    if (value !== null) return value
  }
  return null
}

/**
 * Mechanical adapter for P6/P7 release reporting. It never judges semantic
 * quality and it never derives end-to-end TTFT from a partial stream metric.
 * Missing counters remain null: zero is reserved for a measured zero.
 *
 * JetWork AI Quality Lab already defines primary_llm_agent_calls as controller
 * provider rounds and primary_llm_agent_calls + primary_llm_final_calls as the
 * primary runtime provider-call count. Reuse that telemetry instead of creating
 * a second counting convention.
 */
export const adaptAgenticRuntimePerformanceMetrics = (
  input: AgenticRuntimeMechanicalTelemetryInput,
): AgenticRuntimeMechanicalPerformance => {
  const usage = input.usage && typeof input.usage === 'object' ? input.usage : {}
  const agentCalls = integerOrNull(usage.primary_llm_agent_calls)
  const finalCalls = integerOrNull(usage.primary_llm_final_calls)
  const derivedProviderCalls = agentCalls !== null && finalCalls !== null
    ? agentCalls + finalCalls
    : null

  return {
    controllerRounds: integerOrNull(input.controllerRounds) ?? agentCalls,
    toolCalls: integerOrNull(input.toolCalls),
    providerCalls: integerOrNull(input.providerCalls) ?? derivedProviderCalls,
    ttftMs: finite(input.endToEndTtftMs),
    streamOpenToFirstTextMs: finite(input.streamOpenToFirstTextMs),
    totalLatencyMs: finite(input.totalLatencyMs),
    inputTokens: firstFinite(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount']),
    outputTokens: firstFinite(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount']),
    costUsd: firstFinite(usage, ['estimated_total_cost_usd', 'estimated_cost_usd', 'cost_usd']),
  }
}
