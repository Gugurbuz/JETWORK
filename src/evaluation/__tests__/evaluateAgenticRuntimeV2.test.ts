import { describe, expect, it } from 'vitest'
import { evaluateAgenticRuntimeV2, summarizeAgenticRuntimeV2 } from '../evaluateAgenticRuntimeV2'
import { AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS } from '../agenticRuntimeV2Scenarios'

describe('Agentic Runtime V2 release scorer', () => {
  it('fails an artifact scenario when executor returns but reload/integrity is not verified', () => {
    const scenario = AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS.find(item => item.category === 'artifact_completion')!
    const result = evaluateAgenticRuntimeV2(scenario, {
      selectedCapabilities: scenario.requiredCapabilities,
      observations: [],
      assertionsSatisfied: scenario.assertions,
      behaviorsObserved: [],
      completed: true,
      artifact: { executorSucceeded: true, reloadVerified: false, integrityVerified: false, persisted: true },
    })
    expect(result.passed).toBe(false)
    expect(result.completionInvariantPassed).toBe(false)
  })

  it('fails closed when a forbidden deterministic routing behavior is observed', () => {
    const scenario = AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS.find(item => item.category === 'exact_technical')!
    const result = evaluateAgenticRuntimeV2(scenario, {
      selectedCapabilities: scenario.requiredCapabilities,
      observations: [],
      assertionsSatisfied: scenario.assertions,
      behaviorsObserved: ['keyword_route'],
      completed: true,
    })
    expect(result.passed).toBe(false)
    expect(result.forbiddenBehaviorsObserved).toEqual(['keyword_route'])
  })

  it('passes only when the full scenario contract is satisfied', () => {
    const scenario = AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS.find(item => item.category === 'memory_correction')!
    const result = evaluateAgenticRuntimeV2(scenario, {
      selectedCapabilities: scenario.requiredCapabilities,
      observations: ['new_user_correction'],
      assertionsSatisfied: scenario.assertions,
      behaviorsObserved: [],
      completed: true,
    })
    expect(result.passed).toBe(true)
    expect(summarizeAgenticRuntimeV2([result])).toMatchObject({ scenarioCount: 1, passedCount: 1, releaseGatePassed: true })
  })
})
