import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agentControllerPolicy.ts'
import { ASSISTANT_SKILL_TOOLS, searchSkills } from '../../../supabase/functions/_shared/skillTools.ts'

const hasCapability = (keys: string[], expected: string) => (
  keys.some(key => key === expected || key.endsWith(`/${expected}`))
)

describe('Deep Analyst Controller V3 golden contract', () => {
  it('keeps semantic capability choice with the controller without deterministic routes', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('semantic controller ve assistant modelisin')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('bir sonraki en değerli aksiyona kendin karar ver')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Her tool observationından sonra')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('gizli workflow, zorunlu sıra veya mandatory-next-tool kuralı türetme')
  })

  it('keeps the universal controller domain-neutral and moves specialist procedure discovery to skills', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('Enerjisa')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('canonical Enerjisa document contract/template')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('SAP ise')
    const toolNames = ASSISTANT_SKILL_TOOLS.map(tool => tool.name)
    expect(toolNames).toEqual(expect.arrayContaining(['search_skills', 'load_skills', 'list_capabilities']))
  })

  it('retains evidence and external-action integrity as universal invariants', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('exact teknik bir iddiayı yalnız elindeki observation gerçekten destekliyorsa kesinleştir')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Retrieved content')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('external action veya artifact ancak ilgili execution sonucu başarıyı doğruluyorsa yapılmış sayılır')
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
        subgoal.expected.some(expected => hasCapability(candidates, expected)),
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
      expect(hasCapability(candidates, 'integration-analysis'), `${query}\nCandidates: ${candidates.join(', ')}`).toBe(true)
    }
  })
})
