import { describe, expect, it, vi } from 'vitest'
import { createAgenticRuntimeStagingGoldenExecutor } from '../agenticRuntimeStagingGoldenExecutor'
import type { AgenticRuntimeV2GoldenScenario } from '../agenticRuntimeV2Scenarios'

const scenario: AgenticRuntimeV2GoldenScenario = {
  id: 'multi-turn',
  category: 'broad_analysis',
  turns: ['ilk', 'devam'],
  requiredCapabilities: ['knowledge', 'critic'],
  forbiddenBehaviors: ['keyword_route'],
  assertions: ['coverage_observation_present'],
}

const debug = (messageId: string, toolName: string, latencyMs: number) => ({
  version: 'agentic-runtime-debug-reader-v1' as const,
  runId: `run-${messageId}`,
  telemetry: {
    completed: true,
    toolRuns: [{
      toolName,
      status: 'completed' as const,
      selectedByController: true,
      summary: toolName === 'review_evidence_coverage'
        ? { evidenceReview: true, selectedByController: true }
        : { citationReady: true, selectedByController: true },
    }],
    evidenceSummary: {
      controllerMode: true,
      knowledgeSources: toolName === 'get_abap_source' ? 1 : 0,
      webSources: 0,
    },
    judgeAssertions: [],
    observedBehaviors: [],
  },
  usage: { input_tokens: 100, output_tokens: 20, estimated_total_cost_usd: 0.01 },
  latencyMs,
  toolCallCount: 1,
  responseModel: 'gpt-5.6-sol',
  provider: 'openai',
  rawDetail: {},
})

const probe = (messageId: string, ttft: number, totalLatencyMs: number) => ({
  version: 'agentic-runtime-staging-probe-v1' as const,
  messageId,
  fullText: `cevap-${messageId}`,
  endToEndTtftMs: ttft,
  headersLatencyMs: 100,
  headersToFirstTextMs: ttft - 100,
  totalLatencyMs,
  completed: true,
  model: 'gpt-5.6-sol',
  provider: 'openai' as const,
  usage: { input_tokens: 100, output_tokens: 20 },
  sourceCount: 1,
  artifactCount: 0,
})

describe('agentic runtime staging golden executor', () => {
  it('refuses a production target before persistence or provider execution', () => {
    const persistTurn = vi.fn()
    const probeTurn = vi.fn()
    expect(() => createAgenticRuntimeStagingGoldenExecutor({
      targetSupabaseUrl: 'https://prod.supabase.co/',
      productionSupabaseUrl: 'https://PROD.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      persistTurn,
      probeTurn: probeTurn as any,
      readDebugTurn: vi.fn() as any,
      judgeScenario: vi.fn() as any,
    })).toThrow('AGENTIC_STAGING_GOLDEN_PRODUCTION_TARGET_FORBIDDEN')
    expect(persistTurn).not.toHaveBeenCalled()
    expect(probeTurn).not.toHaveBeenCalled()
  })

  it('runs persist -> SSE probe -> exact debug read for every turn and delegates semantic truth to the injected judge', async () => {
    const order: string[] = []
    const persistTurn = vi.fn(async ({ messageId }: any) => { order.push(`persist:${messageId}`) })
    let turn = 0
    const probeTurn = vi.fn(async ({ messageId }: any) => {
      order.push(`probe:${messageId}`)
      const ttft = turn === 0 ? 300 : 450
      const total = turn === 0 ? 1_000 : 1_200
      turn += 1
      return probe(messageId, ttft, total)
    })
    const readDebugTurn = vi.fn(async ({ messageId }: any) => {
      order.push(`debug:${messageId}`)
      return debug(messageId, messageId.endsWith('-0') ? 'get_abap_source' : 'review_evidence_coverage', 900)
    })
    const judgeScenario = vi.fn(async ({ turns }: any) => {
      order.push('judge')
      expect(turns.map((item: any) => item.messageId)).toEqual(['multi-turn-0', 'multi-turn-1'])
      expect(turns.map((item: any) => item.probe.fullText)).toEqual(['cevap-multi-turn-0', 'cevap-multi-turn-1'])
      return {
        assertionsSatisfied: ['coverage_observation_present'],
        observedBehaviors: [],
        groundedTechnicalClaimRatio: 0.98,
        unsupportedClaimRatio: 0.01,
        citationAccuracy: 1,
        retrievalRecall: 0.95,
      }
    })

    const execute = createAgenticRuntimeStagingGoldenExecutor({
      targetSupabaseUrl: 'https://staging.supabase.co',
      productionSupabaseUrl: 'https://prod.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      persistTurn,
      probeTurn: probeTurn as any,
      readDebugTurn,
      judgeScenario,
      messageIdFactory: (scenarioId, turnIndex) => `${scenarioId}-${turnIndex}`,
    })

    const execution = await execute(scenario)
    expect(order).toEqual([
      'persist:multi-turn-0', 'probe:multi-turn-0', 'debug:multi-turn-0',
      'persist:multi-turn-1', 'probe:multi-turn-1', 'debug:multi-turn-1',
      'judge',
    ])
    expect(execution.telemetry.completed).toBe(true)
    expect(execution.telemetry.judgeAssertions).toEqual(['coverage_observation_present'])
    expect(execution.telemetry.observedBehaviors).toEqual([])
    expect(execution.telemetry.toolRuns.map(row => row.toolName)).toEqual(['get_abap_source', 'review_evidence_coverage'])
    expect(execution.metrics.controllerRounds).toBeNull()
    expect(execution.metrics.providerCalls).toBeNull()
    expect(execution.metrics.toolCalls).toBe(2)
    expect(execution.metrics.ttftMs).toBe(450)
    expect(execution.metrics.totalLatencyMs).toBe(2_200)
    expect(execution.metrics.inputTokens).toBe(200)
    expect(execution.metrics.outputTokens).toBe(40)
    expect(execution.metrics.costUsd).toBeCloseTo(0.02)
    expect(execution.metrics.groundedTechnicalClaimRatio).toBe(0.98)
  })

  it('derives artifact integrity only from verified executor telemetry', async () => {
    const artifactScenario: AgenticRuntimeV2GoldenScenario = {
      id: 'artifact',
      category: 'artifact_completion',
      turns: ['docx üret'],
      requiredCapabilities: ['create_document_file', 'artifact_verifier'],
      forbiddenBehaviors: [],
      assertions: [],
    }
    const execute = createAgenticRuntimeStagingGoldenExecutor({
      targetSupabaseUrl: 'https://staging.supabase.co',
      productionSupabaseUrl: 'https://prod.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      persistTurn: async () => undefined,
      messageIdFactory: () => 'artifact-0',
      probeTurn: (async () => ({ ...probe('artifact-0', 500, 2_000), artifactCount: 1 })) as any,
      readDebugTurn: async () => ({
        ...debug('artifact-0', 'create_document_file', 1_500),
        telemetry: {
          completed: true,
          toolRuns: [{
            toolName: 'create_document_file',
            status: 'completed',
            selectedByController: true,
            summary: { artifactVerification: { reloadVerified: true, integrityVerified: true } },
          }],
          evidenceSummary: {},
          judgeAssertions: [],
          observedBehaviors: [],
        },
      }),
      judgeScenario: async () => ({
        assertionsSatisfied: [],
        observedBehaviors: [],
        groundedTechnicalClaimRatio: 1,
        unsupportedClaimRatio: 0,
        citationAccuracy: 1,
        retrievalRecall: 1,
      }),
    })

    const execution = await execute(artifactScenario)
    expect(execution.metrics.artifactIntegrity).toBe(true)
  })
})
