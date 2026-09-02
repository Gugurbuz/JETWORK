import { describe, expect, it } from 'vitest'
import {
  adaptAgenticRuntimePerformanceMetrics,
  AGENTIC_RUNTIME_PERFORMANCE_ADAPTER_VERSION,
} from '../agenticRuntimePerformanceAdapter'

describe('agentic runtime performance adapter', () => {
  it('maps mechanical usage and latency without inventing end-to-end TTFT', () => {
    const metrics = adaptAgenticRuntimePerformanceMetrics({
      controllerRounds: 3,
      toolCalls: 5,
      providerCalls: 2,
      streamOpenToFirstTextMs: 420,
      totalLatencyMs: 6_500,
      usage: {
        input_tokens: 1_200,
        output_tokens: 450,
        estimated_total_cost_usd: 0.034,
      },
    })

    expect(AGENTIC_RUNTIME_PERFORMANCE_ADAPTER_VERSION).toBe('agentic-runtime-performance-adapter-v1')
    expect(metrics).toEqual({
      controllerRounds: 3,
      toolCalls: 5,
      providerCalls: 2,
      ttftMs: null,
      streamOpenToFirstTextMs: 420,
      totalLatencyMs: 6_500,
      inputTokens: 1_200,
      outputTokens: 450,
      costUsd: 0.034,
    })
  })

  it('accepts end-to-end TTFT only when explicitly measured and leaves unknown counters null', () => {
    const metrics = adaptAgenticRuntimePerformanceMetrics({
      endToEndTtftMs: 1_850,
      streamOpenToFirstTextMs: 300,
      usage: { promptTokenCount: 900, candidatesTokenCount: 200, estimated_cost_usd: 0.01 },
    })

    expect(metrics.controllerRounds).toBeNull()
    expect(metrics.toolCalls).toBeNull()
    expect(metrics.providerCalls).toBeNull()
    expect(metrics.ttftMs).toBe(1_850)
    expect(metrics.streamOpenToFirstTextMs).toBe(300)
    expect(metrics.inputTokens).toBe(900)
    expect(metrics.outputTokens).toBe(200)
    expect(metrics.costUsd).toBe(0.01)
  })

  it('fails invalid measurement values to null instead of coercing them to zero', () => {
    const metrics = adaptAgenticRuntimePerformanceMetrics({
      controllerRounds: -4,
      toolCalls: Number.NaN,
      endToEndTtftMs: -10,
      streamOpenToFirstTextMs: Number.POSITIVE_INFINITY,
      usage: { input_tokens: 'bad', estimated_total_cost_usd: -1 },
    })

    expect(metrics.controllerRounds).toBeNull()
    expect(metrics.toolCalls).toBeNull()
    expect(metrics.providerCalls).toBeNull()
    expect(metrics.ttftMs).toBeNull()
    expect(metrics.streamOpenToFirstTextMs).toBeNull()
    expect(metrics.inputTokens).toBeNull()
    expect(metrics.costUsd).toBeNull()
  })
})
