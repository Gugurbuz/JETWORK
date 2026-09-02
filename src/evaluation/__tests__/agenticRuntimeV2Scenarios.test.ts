import { describe, expect, it } from 'vitest'
import { AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS } from '../agenticRuntimeV2Scenarios'

describe('Agentic Runtime V2 golden contract', () => {
  it('covers each P6 release category exactly once in the seed suite', () => {
    expect(AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS).toHaveLength(7)
    expect(new Set(AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS.map(item => item.id)).size).toBe(7)
    expect(new Set(AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS.map(item => item.category))).toEqual(new Set([
      'exact_technical',
      'broad_analysis',
      'follow_up_continuity',
      'artifact_completion',
      'current_web',
      'memory_correction',
      'mixed_capabilities',
    ]))
  })

  it('defines both positive assertions and forbidden behavior for every scenario', () => {
    for (const scenario of AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS) {
      expect(scenario.turns.length).toBeGreaterThan(0)
      expect(scenario.requiredCapabilities.length).toBeGreaterThan(0)
      expect(scenario.assertions.length).toBeGreaterThan(0)
      expect(scenario.forbiddenBehaviors.length).toBeGreaterThan(0)
    }
  })

  it('locks the artifact scenario to executor + reload + integrity + persistence completion gates', () => {
    const artifact = AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS.find(item => item.category === 'artifact_completion')!
    expect(artifact.assertions).toEqual(expect.arrayContaining([
      'executor_success_required',
      'reload_required',
      'integrity_required',
      'persistence_required',
    ]))
    expect(artifact.forbiddenBehaviors).toContain('claim_completion_before_reload')
  })

  it('locks memory correction to user authority and supersede semantics', () => {
    const memory = AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS.find(item => item.category === 'memory_correction')!
    expect(memory.assertions).toContain('correction_supersedes_old_version')
    expect(memory.assertions).toContain('user_source_required_for_decision')
    expect(memory.forbiddenBehaviors).toContain('assistant_hypothesis_persisted')
  })
})
