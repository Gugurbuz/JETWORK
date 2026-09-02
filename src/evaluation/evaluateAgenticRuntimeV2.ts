import type { AgenticRuntimeV2GoldenScenario } from './agenticRuntimeV2Scenarios'

export interface AgenticRuntimeTrace {
  selectedCapabilities: string[]
  observations: string[]
  assertionsSatisfied: string[]
  behaviorsObserved: string[]
  completed: boolean
  artifact?: {
    executorSucceeded: boolean
    reloadVerified: boolean
    integrityVerified: boolean
    persisted: boolean
  }
}

export interface AgenticRuntimeEvaluation {
  scenarioId: string
  passed: boolean
  missingCapabilities: string[]
  missingAssertions: string[]
  forbiddenBehaviorsObserved: string[]
  completionInvariantPassed: boolean
}

/**
 * Deterministic release scorer. It never grades semantic answer quality itself;
 * live/judge layers populate trace assertions and this scorer enforces the P6 contract.
 */
export const evaluateAgenticRuntimeV2 = (
  scenario: AgenticRuntimeV2GoldenScenario,
  trace: AgenticRuntimeTrace,
): AgenticRuntimeEvaluation => {
  const selected = new Set(trace.selectedCapabilities)
  const satisfied = new Set(trace.assertionsSatisfied)
  const observed = new Set(trace.behaviorsObserved)

  const missingCapabilities = scenario.requiredCapabilities.filter(capability => !selected.has(capability))
  const missingAssertions = scenario.assertions.filter(assertion => !satisfied.has(assertion))
  const forbiddenBehaviorsObserved = scenario.forbiddenBehaviors.filter(behavior => observed.has(behavior))

  const completionInvariantPassed = scenario.category !== 'artifact_completion'
    && scenario.category !== 'mixed_capabilities'
    ? true
    : Boolean(
      trace.artifact?.executorSucceeded
      && trace.artifact.reloadVerified
      && trace.artifact.integrityVerified
      && trace.artifact.persisted
      && trace.completed
    )

  return {
    scenarioId: scenario.id,
    passed: trace.completed
      && completionInvariantPassed
      && missingCapabilities.length === 0
      && missingAssertions.length === 0
      && forbiddenBehaviorsObserved.length === 0,
    missingCapabilities,
    missingAssertions,
    forbiddenBehaviorsObserved,
    completionInvariantPassed,
  }
}

export const summarizeAgenticRuntimeV2 = (results: readonly AgenticRuntimeEvaluation[]) => ({
  scenarioCount: results.length,
  passedCount: results.filter(result => result.passed).length,
  failedCount: results.filter(result => !result.passed).length,
  passRate: results.length ? results.filter(result => result.passed).length / results.length : 0,
  releaseGatePassed: results.length > 0 && results.every(result => result.passed),
})
