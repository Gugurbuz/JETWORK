import type { AgenticRuntimeDebugReadResult } from './agenticRuntimeDebugReader'
import type { AgenticRuntimeV2LiveExecution, AgenticRuntimeV2ScenarioExecutor } from './runAgenticRuntimeV2Golden'
import type { AgenticRuntimeV2GoldenScenario } from './agenticRuntimeV2Scenarios'
import {
  probeAgenticRuntimeStagingTurn,
  type AgenticRuntimeStagingProbeResult,
} from './agenticRuntimeStagingProbe'

export const AGENTIC_RUNTIME_STAGING_GOLDEN_EXECUTOR_VERSION = 'agentic-runtime-staging-golden-executor-v1'

export interface AgenticRuntimeStagingGoldenTurn {
  turnIndex: number
  messageId: string
  message: string
  probe: AgenticRuntimeStagingProbeResult
  debug: AgenticRuntimeDebugReadResult
}

export interface AgenticRuntimeStagingJudgeResult {
  assertionsSatisfied: string[]
  observedBehaviors: string[]
  groundedTechnicalClaimRatio: number | null
  unsupportedClaimRatio: number | null
  citationAccuracy: number | null
  retrievalRecall: number | null
}

export interface AgenticRuntimeStagingGoldenExecutorConfig {
  targetSupabaseUrl: string
  productionSupabaseUrl: string
  anonKey: string
  accessToken: string
  workspaceId: string
  model?: string
  persistTurn: (input: {
    scenario: AgenticRuntimeV2GoldenScenario
    turnIndex: number
    messageId: string
    message: string
  }) => Promise<void>
  readDebugTurn: (input: {
    workspaceId: string
    messageId: string
  }) => Promise<AgenticRuntimeDebugReadResult>
  judgeScenario: (input: {
    scenario: AgenticRuntimeV2GoldenScenario
    turns: AgenticRuntimeStagingGoldenTurn[]
  }) => Promise<AgenticRuntimeStagingJudgeResult>
  probeTurn?: typeof probeAgenticRuntimeStagingTurn
  messageIdFactory?: (scenarioId: string, turnIndex: number) => string
}

const normalizeUrl = (value: string) => String(value || '').trim().replace(/\/+$/u, '').toLocaleLowerCase('en-US')
const finite = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
const boundedRatio = (value: number | null) => value === null ? null : Math.max(0, Math.min(1, value))
const sumKnown = (values: Array<number | null | undefined>) => {
  const known = values.filter((value): value is number => Number.isFinite(value))
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null
}
const maxKnown = (values: Array<number | null | undefined>) => {
  const known = values.filter((value): value is number => Number.isFinite(value))
  return known.length ? Math.max(...known) : null
}

const usageValue = (usage: Record<string, number>, keys: string[]) => {
  for (const key of keys) {
    const value = finite(usage[key])
    if (value !== null) return value
  }
  return null
}

const mergeEvidenceSummary = (turns: readonly AgenticRuntimeStagingGoldenTurn[]) => {
  const summaries = turns.map(turn => turn.debug.telemetry.evidenceSummary || {})
  const latestDiscovery = [...summaries].reverse().find(summary => summary.capabilityDiscovery)?.capabilityDiscovery || null
  const grounding = [...summaries].reverse().find(summary => summary.groundingCoverage)?.groundingCoverage
  return {
    controllerMode: summaries.some(summary => summary.controllerMode === true),
    capabilityDiscovery: latestDiscovery,
    knowledgeSources: sumKnown(summaries.map(summary => finite(summary.knowledgeSources))) || 0,
    webSources: sumKnown(summaries.map(summary => finite(summary.webSources))) || 0,
    groundingCoverage: grounding,
  }
}

const artifactIntegrityFromTurns = (
  scenario: AgenticRuntimeV2GoldenScenario,
  turns: readonly AgenticRuntimeStagingGoldenTurn[],
): boolean | null => {
  if (scenario.category !== 'artifact_completion' && scenario.category !== 'mixed_capabilities') return null
  const artifactTools = turns.flatMap(turn => turn.debug.telemetry.toolRuns).filter(row => row.toolName === 'create_document_file')
  if (!artifactTools.length) return false
  return artifactTools.some(row => {
    const verification = row.summary?.artifactVerification
    if (!verification || typeof verification !== 'object') return false
    const value = verification as Record<string, unknown>
    return value.reloadVerified === true && value.integrityVerified === true
  })
}

/**
 * Creates the real staging executor consumed by runAgenticRuntimeV2Golden.
 * Mechanical runtime facts come from SSE + reasoning debug telemetry. Semantic
 * assertions/quality ratios MUST come from the injected judgeScenario callback;
 * this executor never self-certifies answer quality or forbidden behaviors.
 */
export const createAgenticRuntimeStagingGoldenExecutor = (
  config: AgenticRuntimeStagingGoldenExecutorConfig,
): AgenticRuntimeV2ScenarioExecutor => {
  const target = normalizeUrl(config.targetSupabaseUrl)
  const production = normalizeUrl(config.productionSupabaseUrl)
  if (!target || !production) throw new Error('AGENTIC_STAGING_GOLDEN_URLS_REQUIRED')
  if (target === production) throw new Error('AGENTIC_STAGING_GOLDEN_PRODUCTION_TARGET_FORBIDDEN')

  const probeTurn = config.probeTurn || probeAgenticRuntimeStagingTurn
  const messageIdFactory = config.messageIdFactory || (() => crypto.randomUUID())

  return async (scenario): Promise<AgenticRuntimeV2LiveExecution> => {
    const turns: AgenticRuntimeStagingGoldenTurn[] = []
    for (const [turnIndex, message] of scenario.turns.entries()) {
      const messageId = messageIdFactory(scenario.id, turnIndex)
      await config.persistTurn({ scenario, turnIndex, messageId, message })
      const probe = await probeTurn({
        targetSupabaseUrl: config.targetSupabaseUrl,
        productionSupabaseUrl: config.productionSupabaseUrl,
        anonKey: config.anonKey,
        accessToken: config.accessToken,
        workspaceId: config.workspaceId,
        model: config.model,
        messageId,
        message,
      })
      const debug = await config.readDebugTurn({ workspaceId: config.workspaceId, messageId })
      turns.push({ turnIndex, messageId, message, probe, debug })
    }

    const judge = await config.judgeScenario({ scenario, turns })
    const allToolRuns = turns.flatMap(turn => turn.debug.telemetry.toolRuns)
    const allUsage = turns.map(turn => turn.debug.usage)
    const toolCalls = sumKnown(turns.map(turn => finite(turn.debug.toolCallCount)))
    const inputTokens = sumKnown(allUsage.map(usage => usageValue(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokenCount'])))
    const outputTokens = sumKnown(allUsage.map(usage => usageValue(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'candidatesTokenCount'])))
    const costUsd = sumKnown(allUsage.map(usage => usageValue(usage, ['estimated_total_cost_usd', 'estimated_cost_usd', 'cost_usd'])))

    return {
      telemetry: {
        completed: turns.length > 0 && turns.every(turn => turn.probe.completed && turn.debug.telemetry.completed),
        toolRuns: allToolRuns,
        evidenceSummary: mergeEvidenceSummary(turns),
        judgeAssertions: [...new Set(judge.assertionsSatisfied)],
        observedBehaviors: [...new Set(judge.observedBehaviors)],
      },
      metrics: {
        groundedTechnicalClaimRatio: boundedRatio(judge.groundedTechnicalClaimRatio),
        unsupportedClaimRatio: boundedRatio(judge.unsupportedClaimRatio),
        citationAccuracy: boundedRatio(judge.citationAccuracy),
        retrievalRecall: boundedRatio(judge.retrievalRecall),
        artifactIntegrity: artifactIntegrityFromTurns(scenario, turns),
        controllerRounds: null,
        toolCalls,
        providerCalls: null,
        ttftMs: maxKnown(turns.map(turn => turn.probe.endToEndTtftMs)),
        streamOpenToFirstTextMs: null,
        totalLatencyMs: sumKnown(turns.map(turn => turn.probe.totalLatencyMs)),
        inputTokens,
        outputTokens,
        costUsd,
      },
    }
  }
}
