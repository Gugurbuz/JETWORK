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

const result = (messageId: string, ttft: number | null, totalLatencyMs: number, artifactCount = 0) => ({
  version: 'agentic-runtime-staging-probe-v1' as const,
  messageId,
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
  it('persists each exact user turn before probing and aggregates only measured text TTFT values', async () => {
    const outcomes = [
      { ttft: 300, total: 1_000, artifacts: 0 },
      { ttft: 500, total: 1_200, artifacts: 0 },
      { ttft: null, total: 1_500, artifacts: 1 },
    ]
    let index = 0
    const beforeTurn = vi.fn(async (input: any) => input)
    const probeTurn = vi.fn(async (input: any) => {
      const outcome = outcomes[index++]
      return result(input.messageId, outcome.ttft, outcome.total, outcome.artifacts)
    })

    const suite = await runAgenticRuntimeStagingProbeSuite({
      targetSupabaseUrl: 'https://staging.supabase.co',
      productionSupabaseUrl: 'https://prod.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      scenarios,
      beforeTurn,
      probeTurn: probeTurn as any,
      messageIdFactory: (scenarioId, turnIndex) => `${scenarioId}-${turnIndex}`,
    })

    expect(beforeTurn).toHaveBeenCalledTimes(3)
    expect(probeTurn).toHaveBeenCalledTimes(3)
    expect(beforeTurn.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ scenarioId: 's1', turnIndex: 0, messageId: 's1-0', message: 'one' }),
      expect.objectContaining({ scenarioId: 's2', turnIndex: 0, messageId: 's2-0', message: 'two-a' }),
      expect.objectContaining({ scenarioId: 's2', turnIndex: 1, messageId: 's2-1', message: 'two-b' }),
    ])
    expect(probeTurn.mock.calls.map(call => call[0].messageId)).toEqual(['s1-0', 's2-0', 's2-1'])
    for (let turn = 0; turn < 3; turn += 1) {
      expect(beforeTurn.mock.invocationCallOrder[turn]).toBeLessThan(probeTurn.mock.invocationCallOrder[turn])
    }
    expect(suite.scenarioResults.flatMap(item => item.turns.map(turn => turn.messageId))).toEqual(['s1-0', 's2-0', 's2-1'])
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
