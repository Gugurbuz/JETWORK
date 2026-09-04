export const AGENT_RUNTIME_TELEMETRY_VERSION = 'agent-runtime-telemetry-v2'

export type RuntimeTimingMark =
  | 'request_received'
  | 'turn_claimed'
  | 'context_resolved'
  | 'capability_discovery_completed'
  | 'controller_first_decision'
  | 'final_generation_started'
  | 'first_text_delta'
  | 'completed'

export interface RuntimeTimingBreakdown {
  version: typeof AGENT_RUNTIME_TELEMETRY_VERSION
  requestToClaimMs: number | null
  claimToContextMs: number | null
  contextToCapabilityDiscoveryMs: number | null
  capabilityDiscoveryLatencyMs: number | null
  contextToControllerFirstDecisionMs: number | null
  finalGenerationStartMs: number | null
  firstTextDeltaTtftMs: number | null
  generationToFirstTextDeltaMs: number | null
  streamDurationMs: number | null
  totalTurnMs: number | null
  toolLatencyMs: Record<string, number[]>
}

const delta = (marks: Map<RuntimeTimingMark, number>, from: RuntimeTimingMark, to: RuntimeTimingMark) => {
  const start = marks.get(from)
  const end = marks.get(to)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Number(end) - Number(start))
}

export interface RuntimeTelemetryTracker {
  version: typeof AGENT_RUNTIME_TELEMETRY_VERSION
  mark: (name: RuntimeTimingMark, atMs?: number) => void
  recordToolLatency: (toolName: string, latencyMs: number) => void
  snapshot: () => RuntimeTimingBreakdown
}

/**
 * Mechanical timing tracker only. It records already-occurring runtime events;
 * it never selects providers/capabilities or changes controller behavior.
 *
 * TTFT is defined as request_received -> first_text_delta. Generation start is
 * intentionally kept as a separate phase mark so planner/controller delay is
 * never mislabeled as first-token latency.
 */
export const createRuntimeTelemetryTracker = (now: () => number = () => performance.now()): RuntimeTelemetryTracker => {
  const marks = new Map<RuntimeTimingMark, number>()
  const toolLatencyMs = new Map<string, number[]>()

  return {
    version: AGENT_RUNTIME_TELEMETRY_VERSION,
    mark(name, atMs = now()) {
      if (!marks.has(name) && Number.isFinite(atMs)) marks.set(name, Number(atMs))
    },
    recordToolLatency(toolName, latencyMs) {
      const name = String(toolName || '').trim().slice(0, 160)
      if (!name || !Number.isFinite(latencyMs) || latencyMs < 0) return
      const values = toolLatencyMs.get(name) || []
      values.push(Number(latencyMs))
      toolLatencyMs.set(name, values.slice(-50))
    },
    snapshot() {
      return {
        version: AGENT_RUNTIME_TELEMETRY_VERSION,
        requestToClaimMs: delta(marks, 'request_received', 'turn_claimed'),
        claimToContextMs: delta(marks, 'turn_claimed', 'context_resolved'),
        contextToCapabilityDiscoveryMs: delta(marks, 'context_resolved', 'capability_discovery_completed'),
        capabilityDiscoveryLatencyMs: delta(marks, 'context_resolved', 'capability_discovery_completed'),
        contextToControllerFirstDecisionMs: delta(marks, 'context_resolved', 'controller_first_decision'),
        finalGenerationStartMs: delta(marks, 'request_received', 'final_generation_started'),
        firstTextDeltaTtftMs: delta(marks, 'request_received', 'first_text_delta'),
        generationToFirstTextDeltaMs: delta(marks, 'final_generation_started', 'first_text_delta'),
        streamDurationMs: delta(marks, 'first_text_delta', 'completed'),
        totalTurnMs: delta(marks, 'request_received', 'completed'),
        toolLatencyMs: Object.fromEntries([...toolLatencyMs.entries()].map(([name, values]) => [name, [...values]])),
      }
    },
  }
}
