import { describe, expect, it, vi } from 'vitest'
import { runAgenticRuntimeStagingProbeSuite } from '../agenticRuntimeStagingSuite'
import type { AgenticRuntimeV2GoldenScenario } from '../agenticRuntimeV2Scenarios'

const scenarios: AgenticRuntimeV2GoldenScenario[] = [
  {
    id: 's1',
    category: 'exact_technical',
    turns: ['one'],
    requiredCapabilities: [],
    forbiddenBehaviors: [],
    assertions: [],
  },
  {
    id: 's2',
    category: 'follow_up_continuity',
    turns: ['two-a', 'two-b'],
    requiredCapabilities: [],
    forbiddenBehaviors: [],
    assertions: [],
  },
]

const result = (ttft: number | null, totalLatencyMs: number, artifactCount = 0) => ({
  version: 'agentic-runtime-staging-probe-v1' as const,
  fullText: ttft === null ? '' : 'ok',
  endToEndTtftMs: ttft,
  headersLatencyMs: 100,
  headersToFirstTextMs: ttft === null ? null : Math.max(0, ttft - 100),
  totalLatencyMs,
  completed: true,
  sourceCount: 0,
  artifactCount,
})

describe('agentic runtime staging probe suite', () => {
  it('runs scenario turns sequentially and aggregates only measured text TTFT values', async () => {
    const probeTurn = vi.fn()
      .mockResolvedValueOnce(result(300, 1_000))
      .mockResolvedValueOnce(result(500, 1_200))
      .mockResolvedValueOnce(result(null, 1_500, 1))

    const suite = await runAgenticRuntimeStagingProbeSuite({
      targetSupabaseUrl: 'https://staging.supabase.co',
      productionSupabaseUrl: 'https://prod.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      scenarios,
      probeTurn: probeTurn as any,
      messageIdFactory: (scenarioId, turnIndex) => `${scenarioId}-${turnIndex}`,
    })

    expect(probeTurn).toHaveBeenCalledTimes(3)
    expect(probeTurn.mock.calls.map(call => call[0].messageId)).toEqual(['s1-0', 's2-0', 's2-1'])
    expect(suite.scenarioCount).toBe(2)
    expect(suite.turnCount).toBe(3)
    expect(suite.performance.endToEndTtftP50Ms).toBe(300)
    expect(suite.performance.endToEndTtftP95Ms).toBe(500)
    expect(suite.performance.totalLatencyP50Ms).toBe(1_200)
    expect(suite.performance.totalLatencyP95Ms).toBe(1_500)
    expect(suite.performance.artifactOnlyTurnCount).toBe(1)
    expect(suite.note).toMatch(/does not replace P6 semantic quality/i)
  })
})
