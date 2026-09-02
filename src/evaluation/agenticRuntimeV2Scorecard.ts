export const AGENTIC_RUNTIME_V2_SCORECARD_VERSION = 'agentic-runtime-v2-scorecard-v1'

export interface AgenticRuntimeRunMetrics {
  scenarioId: string
  critical: boolean
  taskSuccess: boolean
  groundedTechnicalClaimRatio: number | null
  unsupportedClaimRatio: number | null
  citationAccuracy: number | null
  retrievalRecall: number | null
  artifactIntegrity: boolean | null
  controllerRounds: number | null
  toolCalls: number | null
  providerCalls: number | null
  ttftMs: number | null
  streamOpenToFirstTextMs?: number | null
  totalLatencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
}

export interface AgenticRuntimeQualityThresholds {
  taskSuccessRate: number
  groundedTechnicalClaimRatio: number
  unsupportedClaimRatioMax: number
  criticalSuccessRate: number
  artifactIntegrityRate: number
}

export const DEFAULT_AGENTIC_RUNTIME_QUALITY_THRESHOLDS: AgenticRuntimeQualityThresholds = {
  taskSuccessRate: 0.90,
  groundedTechnicalClaimRatio: 0.95,
  unsupportedClaimRatioMax: 0.02,
  criticalSuccessRate: 1,
  artifactIntegrityRate: 1,
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const finiteOrNull = (value: number | null | undefined) => Number.isFinite(value) ? Number(value) : null
const average = (values: Array<number | null | undefined>) => {
  const finite = values.map(finiteOrNull).filter((value): value is number => value !== null)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}
const percentile = (values: Array<number | null | undefined>, p: number) => {
  const finite = values.map(finiteOrNull).filter((value): value is number => value !== null).sort((a, b) => a - b)
  if (!finite.length) return null
  const index = Math.min(finite.length - 1, Math.max(0, Math.ceil(clamp01(p) * finite.length) - 1))
  return finite[index]
}

export const summarizeAgenticRuntimeV2Scorecard = (
  runs: readonly AgenticRuntimeRunMetrics[],
  thresholds: AgenticRuntimeQualityThresholds = DEFAULT_AGENTIC_RUNTIME_QUALITY_THRESHOLDS,
) => {
  const total = runs.length
  const successful = runs.filter(run => run.taskSuccess).length
  const critical = runs.filter(run => run.critical)
  const criticalSuccessful = critical.filter(run => run.taskSuccess).length
  const artifactRuns = runs.filter(run => run.artifactIntegrity !== null)
  const artifactPassed = artifactRuns.filter(run => run.artifactIntegrity === true).length

  const taskSuccessRate = total ? successful / total : 0
  const criticalSuccessRate = critical.length ? criticalSuccessful / critical.length : 0
  const groundedTechnicalClaimRatio = average(runs.map(run => run.groundedTechnicalClaimRatio))
  const unsupportedClaimRatio = average(runs.map(run => run.unsupportedClaimRatio))
  const citationAccuracy = average(runs.map(run => run.citationAccuracy))
  const retrievalRecall = average(runs.map(run => run.retrievalRecall))
  const artifactIntegrityRate = artifactRuns.length ? artifactPassed / artifactRuns.length : 1

  const gates = {
    taskSuccess: taskSuccessRate >= thresholds.taskSuccessRate,
    grounding: groundedTechnicalClaimRatio !== null
      && groundedTechnicalClaimRatio >= thresholds.groundedTechnicalClaimRatio,
    unsupportedClaims: unsupportedClaimRatio !== null
      && unsupportedClaimRatio <= thresholds.unsupportedClaimRatioMax,
    critical: critical.length > 0 && criticalSuccessRate >= thresholds.criticalSuccessRate,
    artifactIntegrity: artifactIntegrityRate >= thresholds.artifactIntegrityRate,
  }

  return {
    version: AGENTIC_RUNTIME_V2_SCORECARD_VERSION,
    runCount: total,
    quality: {
      taskSuccessRate,
      groundedTechnicalClaimRatio,
      unsupportedClaimRatio,
      citationAccuracy,
      retrievalRecall,
      criticalSuccessRate,
      artifactIntegrityRate,
    },
    behavior: {
      controllerRoundsAvg: average(runs.map(run => run.controllerRounds)),
      toolCallsAvg: average(runs.map(run => run.toolCalls)),
      providerCallsAvg: average(runs.map(run => run.providerCalls)),
    },
    performance: {
      ttftP50Ms: percentile(runs.map(run => run.ttftMs), 0.50),
      ttftP95Ms: percentile(runs.map(run => run.ttftMs), 0.95),
      streamOpenToFirstTextP50Ms: percentile(runs.map(run => run.streamOpenToFirstTextMs), 0.50),
      streamOpenToFirstTextP95Ms: percentile(runs.map(run => run.streamOpenToFirstTextMs), 0.95),
      totalLatencyP50Ms: percentile(runs.map(run => run.totalLatencyMs), 0.50),
      totalLatencyP95Ms: percentile(runs.map(run => run.totalLatencyMs), 0.95),
      inputTokensAvg: average(runs.map(run => run.inputTokens)),
      outputTokensAvg: average(runs.map(run => run.outputTokens)),
      costPerTurnAvgUsd: average(runs.map(run => run.costUsd)),
      costPerSuccessfulGroundedAnswerUsd: (() => {
        const eligible = runs.filter(run => run.taskSuccess && (run.groundedTechnicalClaimRatio ?? 1) >= thresholds.groundedTechnicalClaimRatio)
        const costs = eligible.map(run => run.costUsd)
        return average(costs)
      })(),
    },
    thresholds,
    gates,
    releaseQualityGatePassed: total > 0 && Object.values(gates).every(Boolean),
    note: 'Unknown behavior/performance counts remain null rather than being coerced to zero. Latency and cost are observational until P7 establishes an accepted baseline/regression budget. streamOpenToFirstTextMs is a stream-layer metric and is not end-to-end TTFT.',
  }
}
