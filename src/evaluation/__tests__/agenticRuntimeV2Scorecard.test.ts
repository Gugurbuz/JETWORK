import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENTIC_RUNTIME_QUALITY_THRESHOLDS,
  summarizeAgenticRuntimeV2Scorecard,
} from '../agenticRuntimeV2Scorecard'

const run = (overrides: Record<string, unknown> = {}) => ({
  scenarioId: 's1',
  critical: true,
  taskSuccess: true,
  groundedTechnicalClaimRatio: 0.98,
  unsupportedClaimRatio: 0.01,
  citationAccuracy: 1,
  retrievalRecall: 0.95,
  artifactIntegrity: true,
  controllerRounds: 2,
  toolCalls: 3,
  providerCalls: 2,
  ttftMs: 1200,
  streamOpenToFirstTextMs: 300,
  totalLatencyMs: 5000,
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0.02,
  ...overrides,
})

describe('agentic runtime v2 scorecard', () => {
  it('passes the quality gate when P6 thresholds are met', () => {
    const summary = summarizeAgenticRuntimeV2Scorecard([
      run({ scenarioId: 's1' }),
      run({ scenarioId: 's2', critical: false, ttftMs: 1800, streamOpenToFirstTextMs: 450, totalLatencyMs: 7000 }),
    ] as any)

    expect(summary.releaseQualityGatePassed).toBe(true)
    expect(summary.quality.taskSuccessRate).toBe(1)
    expect(summary.performance.ttftP50Ms).toBe(1200)
    expect(summary.performance.ttftP95Ms).toBe(1800)
    expect(summary.performance.streamOpenToFirstTextP50Ms).toBe(300)
    expect(summary.performance.streamOpenToFirstTextP95Ms).toBe(450)
    expect(summary.performance.costPerSuccessfulGroundedAnswerUsd).toBeCloseTo(0.02)
  })

  it('fails closed on grounding, unsupported claims, or critical scenario regression', () => {
    const summary = summarizeAgenticRuntimeV2Scorecard([
      run({ groundedTechnicalClaimRatio: 0.90, unsupportedClaimRatio: 0.05, taskSuccess: false }),
    ] as any)

    expect(summary.gates.grounding).toBe(false)
    expect(summary.gates.unsupportedClaims).toBe(false)
    expect(summary.gates.critical).toBe(false)
    expect(summary.releaseQualityGatePassed).toBe(false)
  })

  it('keeps latency/cost observational until P7 baseline thresholds exist', () => {
    const summary = summarizeAgenticRuntimeV2Scorecard([
      run({ ttftMs: 999_999, streamOpenToFirstTextMs: 777_777, totalLatencyMs: 999_999, costUsd: 99 }),
    ] as any, DEFAULT_AGENTIC_RUNTIME_QUALITY_THRESHOLDS)

    expect(summary.releaseQualityGatePassed).toBe(true)
    expect(summary.performance.ttftP95Ms).toBe(999_999)
    expect(summary.performance.streamOpenToFirstTextP95Ms).toBe(777_777)
    expect(summary.note).toMatch(/not end-to-end TTFT/i)
  })
})
