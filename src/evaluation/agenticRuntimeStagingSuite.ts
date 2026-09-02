import {
  AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS,
  type AgenticRuntimeV2GoldenScenario,
} from './agenticRuntimeV2Scenarios'
import {
  probeAgenticRuntimeStagingTurn,
  type AgenticRuntimeStagingProbeInput,
  type AgenticRuntimeStagingProbeResult,
} from './agenticRuntimeStagingProbe'

export const AGENTIC_RUNTIME_STAGING_SUITE_VERSION = 'agentic-runtime-staging-suite-v1'

export interface AgenticRuntimeStagingBeforeTurnInput {
  scenarioId: string
  category: AgenticRuntimeV2GoldenScenario['category']
  turnIndex: number
  messageId: string
  message: string
}

export interface AgenticRuntimeStagingSuiteConfig extends Omit<AgenticRuntimeStagingProbeInput,
  'messageId' | 'message' | 'fetchImpl' | 'now'> {
  scenarios?: readonly AgenticRuntimeV2GoldenScenario[]
  probeTurn?: typeof probeAgenticRuntimeStagingTurn
  messageIdFactory?: (scenarioId: string, turnIndex: number) => string
  beforeTurn?: (input: AgenticRuntimeStagingBeforeTurnInput) => Promise<void>
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

/**
 * Runs every declared golden turn sequentially against staging and returns raw
 * transport/performance observations. The beforeTurn hook persists the exact
 * user message before the gateway resolves its current semantic context.
 * This suite is deliberately not a semantic release judge; P6 still owns
 * task-success/grounding/assertion evaluation.
 */
export async function runAgenticRuntimeStagingProbeSuite(
  config: AgenticRuntimeStagingSuiteConfig,
) {
  const scenarios = config.scenarios || AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS
  const probeTurn = config.probeTurn || probeAgenticRuntimeStagingTurn
  const messageIdFactory = config.messageIdFactory || (() => crypto.randomUUID())
  const scenarioResults: Array<{
    scenarioId: string
    category: AgenticRuntimeV2GoldenScenario['category']
    turns: AgenticRuntimeStagingProbeResult[]
  }> = []

  for (const scenario of scenarios) {
    const turns: AgenticRuntimeStagingProbeResult[] = []
    for (const [turnIndex, message] of scenario.turns.entries()) {
      const messageId = messageIdFactory(scenario.id, turnIndex)
      if (config.beforeTurn) {
        await config.beforeTurn({
          scenarioId: scenario.id,
          category: scenario.category,
          turnIndex,
          messageId,
          message,
        })
      }
      turns.push(await probeTurn({
        targetSupabaseUrl: config.targetSupabaseUrl,
        productionSupabaseUrl: config.productionSupabaseUrl,
        anonKey: config.anonKey,
        accessToken: config.accessToken,
        workspaceId: config.workspaceId,
        model: config.model,
        messageId,
        message,
      }))
    }
    scenarioResults.push({ scenarioId: scenario.id, category: scenario.category, turns })
  }

  const allTurns = scenarioResults.flatMap(result => result.turns)
  const textTurns = allTurns.filter(turn => turn.endToEndTtftMs !== null)
  const ttft = textTurns.map(turn => Number(turn.endToEndTtftMs))
  const total = allTurns.map(turn => turn.totalLatencyMs)
  const headers = allTurns.map(turn => turn.headersLatencyMs)

  return {
    version: AGENTIC_RUNTIME_STAGING_SUITE_VERSION,
    scenarioCount: scenarioResults.length,
    turnCount: allTurns.length,
    scenarioResults,
    performance: {
      endToEndTtftP50Ms: percentile(ttft, 0.50),
      endToEndTtftP95Ms: percentile(ttft, 0.95),
      totalLatencyP50Ms: percentile(total, 0.50),
      totalLatencyP95Ms: percentile(total, 0.95),
      headersLatencyP50Ms: percentile(headers, 0.50),
      headersLatencyP95Ms: percentile(headers, 0.95),
      artifactOnlyTurnCount: allTurns.filter(turn => turn.endToEndTtftMs === null && turn.artifactCount > 0).length,
    },
    note: 'Performance-only staging baseline. This suite does not replace P6 semantic quality, grounding, artifact integrity, or forbidden-behavior gates.',
  }
}
