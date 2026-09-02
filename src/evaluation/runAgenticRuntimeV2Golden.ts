import {
  AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS,
  type AgenticRuntimeV2GoldenScenario,
} from './agenticRuntimeV2Scenarios'
import {
  adaptAgenticRuntimeTelemetry,
  type AgenticRuntimeTelemetryInput,
} from './agenticRuntimeTraceAdapter'
import {
  evaluateAgenticRuntimeV2,
  summarizeAgenticRuntimeV2,
} from './evaluateAgenticRuntimeV2'
import {
  summarizeAgenticRuntimeV2Scorecard,
  type AgenticRuntimeRunMetrics,
} from './agenticRuntimeV2Scorecard'

export const AGENTIC_RUNTIME_V2_GOLDEN_RUNNER_VERSION = 'agentic-runtime-v2-golden-runner-v1'

export interface AgenticRuntimeV2LiveExecution {
  telemetry: AgenticRuntimeTelemetryInput
  metrics: Omit<AgenticRuntimeRunMetrics, 'scenarioId' | 'critical' | 'taskSuccess'>
}

export type AgenticRuntimeV2ScenarioExecutor = (
  scenario: AgenticRuntimeV2GoldenScenario,
) => Promise<AgenticRuntimeV2LiveExecution>

const isCriticalScenario = (scenario: AgenticRuntimeV2GoldenScenario) => (
  scenario.category === 'exact_technical'
  || scenario.category === 'artifact_completion'
  || scenario.category === 'memory_correction'
  || scenario.category === 'mixed_capabilities'
)

/**
 * Executes P6 scenarios against a caller-provided live/live-like runtime.
 * This harness does not choose tools or judge semantic quality itself. The
 * executor supplies runtime telemetry and judge assertions; deterministic
 * release gates only enforce the declared scenario and quality contracts.
 */
export const runAgenticRuntimeV2Golden = async (input: {
  execute: AgenticRuntimeV2ScenarioExecutor
  scenarios?: readonly AgenticRuntimeV2GoldenScenario[]
}) => {
  const scenarios = input.scenarios || AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS
  const scenarioResults = []
  const runMetrics: AgenticRuntimeRunMetrics[] = []

  for (const scenario of scenarios) {
    const execution = await input.execute(scenario)
    const trace = adaptAgenticRuntimeTelemetry(execution.telemetry)
    const evaluation = evaluateAgenticRuntimeV2(scenario, trace)
    scenarioResults.push({
      scenarioId: scenario.id,
      category: scenario.category,
      trace,
      evaluation,
    })
    runMetrics.push({
      scenarioId: scenario.id,
      critical: isCriticalScenario(scenario),
      taskSuccess: evaluation.passed,
      ...execution.metrics,
    })
  }

  return {
    version: AGENTIC_RUNTIME_V2_GOLDEN_RUNNER_VERSION,
    scenarioSummary: summarizeAgenticRuntimeV2(scenarioResults.map(result => result.evaluation)),
    scorecard: summarizeAgenticRuntimeV2Scorecard(runMetrics),
    scenarioResults,
    releaseGatePassed: scenarioResults.length > 0
      && scenarioResults.every(result => result.evaluation.passed)
      && summarizeAgenticRuntimeV2Scorecard(runMetrics).releaseQualityGatePassed,
  }
}
