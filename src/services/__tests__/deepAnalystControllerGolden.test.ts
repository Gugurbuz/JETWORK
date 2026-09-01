import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agentControllerPolicy.ts'
import { searchSkills } from '../../../supabase/functions/_shared/skillTools.ts'

describe('Deep Analyst controller golden contract', () => {
  it('keeps capability choice with the controller instead of deterministic routes', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Deterministic routing avoidance')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('semantik seçimi controller modeli yapar')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Sabit bir planner→research→analysis→critic sırası yoktur')
  })

  it('preserves deep enterprise analysis and evidence invariants', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('yalnız talebi özetleyip bitirme')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('sistem ve entegrasyon etkileri')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Exact teknik identifier')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Knowledge ile web birbirinin alternatifi olmak zorunda değildir')
  })

  it('preserves the canonical Enerjisa artifact contract without a second template', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('canonical Enerjisa document contract/template tek otoritedir')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('legacy fallback chapter')
  })

  it('surfaces a useful capability set for a generic enterprise change-analysis workflow', () => {
    const controllerSubgoals = [
      {
        query: 'understand and decompose the business requirement before designing a solution',
        expected: ['requirement-understanding', 'requirement-decomposition'],
      },
      {
        query: 'analyze integration boundaries, connected systems and interfaces',
        expected: ['integration-analysis'],
      },
      {
        query: 'analyze dependencies and downstream effects of the proposed change',
        expected: ['dependency-analysis', 'impact-analysis'],
      },
      {
        query: 'analyze technical behavior, data flow and implementation constraints',
        expected: ['technical-analysis'],
      },
      {
        query: 'identify material risks and unresolved assumptions before approval',
        expected: ['risk-analysis', 'assumption-management'],
      },
    ]

    for (const subgoal of controllerSubgoals) {
      const candidates = searchSkills({ query: subgoal.query, limit: 12 }).map(result => result.key)
      expect(
        subgoal.expected.some(expected => candidates.includes(expected)),
        `${subgoal.query}\nCandidates: ${candidates.join(', ')}`,
      ).toBe(true)
    }
  })

  it('does not require a product-specific keyword to find integration-analysis', () => {
    const phrasings = [
      'entegrasyonları ve etkilenen sistemleri incele',
      'connected systems and integration boundaries',
      'entegrasyonlr ile sistemler arasi baglantilari kontrol et',
    ]

    for (const query of phrasings) {
      const candidates = searchSkills({ query, limit: 12 }).map(result => result.key)
      expect(candidates, query).toContain('integration-analysis')
    }
  })
})
