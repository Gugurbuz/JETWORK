import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addEvidence,
  createEvidenceMap,
  registerConflict,
  setCoverageAspects,
} from '../../../supabase/functions/_shared/evidence/evidenceMap.ts'
import { critiqueEvidenceMap } from '../../../supabase/functions/_shared/evidence/critic.ts'

const criticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/evidence/critic.ts', import.meta.url),
  'utf8',
)

describe('Evidence Map + Coverage + Critic v2', () => {
  it('distinguishes evidence existence from question coverage', () => {
    let map = createEvidenceMap('CHECK_ZTKS hangi mesajları üretir ve hangi koşullarda?')
    map = addEvidence(map, {
      id: 'ev-method',
      source: 'CHECK_ZTKS source',
      sourceType: 'knowledge',
      object: 'method:check_ztks',
      supports: ['544 message', '545 message', '586 message'],
      trustLevel: 'published-enterprise-source',
      scope: 'CRM',
      conflicts: [],
    })
    map = addEvidence(map, {
      id: 'ev-544',
      source: 'ZCRM2-544 detail',
      sourceType: 'knowledge',
      object: 'message:zcrm2-544',
      supports: ['544 trigger condition'],
      trustLevel: 'published-enterprise-source',
      scope: 'CRM',
      conflicts: [],
    })
    map = setCoverageAspects(map, [
      { id: 'messages', label: 'messages', evidenceIds: ['ev-method'], status: 'covered' },
      { id: 'condition-544', label: '544 condition', evidenceIds: ['ev-544'], status: 'covered' },
      { id: 'condition-545', label: '545 condition', evidenceIds: [], status: 'open' },
      { id: 'condition-586', label: '586 condition', evidenceIds: ['ev-method'], status: 'partial' },
    ])

    const observation = critiqueEvidenceMap(map)
    expect(observation.coverage).toBe(0.625)
    expect(observation.gaps).toContain('545 condition: no verified evidence')
    expect(observation.gaps).toContain('586 condition: partially supported')
  })

  it('records conflicts structurally instead of choosing which source wins', () => {
    let map = createEvidenceMap('start date nedir?')
    map = addEvidence(map, {
      id: 'ev-a', source: 'Source A', sourceType: 'knowledge', supports: ['start_date=01.09'],
      trustLevel: 'published-enterprise-source', conflicts: [],
    })
    map = addEvidence(map, {
      id: 'ev-b', source: 'Source B', sourceType: 'knowledge', supports: ['start_date=15.09'],
      trustLevel: 'published-enterprise-source', conflicts: [],
    })
    map = registerConflict(map, 'start_date', ['ev-a', 'ev-b'])

    const observation = critiqueEvidenceMap(map)
    expect(observation.conflicts).toEqual(['start_date'])
    expect(observation.suggestedFocus).toContain('resolve conflict: start_date')
  })

  it('keeps critic as an observation layer rather than a second planner', () => {
    expect(criticSource).toContain('controllerDecisionRequired: true')
    expect(criticSource).not.toContain('executeAssistantTool')
    expect(criticSource).not.toContain('executeSkillTool')
    expect(criticSource).not.toContain('toolName')
    expect(criticSource).not.toContain('forceSynthesis')
  })

  it('does not allow a covered status without any evidence reference', () => {
    const map = setCoverageAspects(createEvidenceMap('question'), [
      { id: 'a', label: 'aspect A', evidenceIds: [], status: 'covered' },
    ])
    expect(map.aspects[0].status).toBe('open')
  })
})
