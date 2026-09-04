import { describe, expect, it } from 'vitest'
import {
  durableProjectMemoryCandidates,
  emptyResolvedConversationState,
  reduceResolvedConversationState,
} from '../../../supabase/functions/_shared/context/stateReducer.ts'

describe('Resolved Conversation State v2 lifecycle', () => {
  it('persists explicit user decisions but never assistant hypotheses as durable state', () => {
    const result = reduceResolvedConversationState(emptyResolvedConversationState(), [
      {
        class: 'DECISION',
        key: 'semantic-routing',
        value: 'LLM controlled',
        source: 'user',
      },
      {
        class: 'AI_HYPOTHESIS',
        key: 'likely-root-cause',
        value: 'Probably cache invalidation',
        source: 'assistant',
      },
    ])

    expect(result.state.decisions).toMatchObject([
      { key: 'semantic-routing', value: 'LLM controlled', source: 'user' },
    ])
    expect(result.state.projectFacts).toEqual([])
    expect(result.dropped.some(item => item.reason === 'ai_hypothesis_not_durable')).toBe(true)
  })

  it('lets an explicit user correction replace stale state instead of resurrecting the old value', () => {
    const first = reduceResolvedConversationState(emptyResolvedConversationState(), [{
      class: 'DECISION',
      key: 'runtime-rollout',
      value: 'direct production',
      source: 'user',
    }]).state

    const corrected = reduceResolvedConversationState(first, [{
      class: 'CORRECTION',
      key: 'runtime-rollout',
      value: 'internal canary first',
      source: 'user',
      correctionTarget: 'decision',
    }]).state

    expect(corrected.decisions).toHaveLength(1)
    expect(corrected.decisions[0].value).toBe('internal canary first')
    expect(corrected.corrections[0].value).toBe('internal canary first')
  })

  it('requires evidence refs before an evidence-derived technical fact can enter resolved state', () => {
    const result = reduceResolvedConversationState(emptyResolvedConversationState(), [
      {
        class: 'PROJECT_FACT',
        key: 'zcrm2-545-trigger',
        value: 'ZTKS incompatible guarantee type',
        source: 'verified_evidence',
        evidenceRefs: [],
      },
      {
        class: 'PROJECT_FACT',
        key: 'zcrm2-586-trigger',
        value: 'GB alınmayacak flag blocks Z32',
        source: 'verified_evidence',
        evidenceRefs: ['knowledge:message:zcrm2-586'],
      },
    ])

    expect(result.state.projectFacts).toHaveLength(1)
    expect(result.state.projectFacts[0].key).toBe('zcrm2-586-trigger')
    expect(result.dropped.some(item => item.reason === 'project_fact_requires_user_or_verified_evidence')).toBe(true)
  })

  it('moves progress between open and completed without duplicating the task', () => {
    const open = reduceResolvedConversationState(emptyResolvedConversationState(), [{
      class: 'PROGRESS',
      key: 'p2-discovery',
      value: 'Capability index wiring',
      source: 'runtime',
      progressState: 'open',
    }]).state

    const completed = reduceResolvedConversationState(open, [{
      class: 'PROGRESS',
      key: 'p2-discovery',
      value: 'Capability index wiring',
      source: 'runtime',
      progressState: 'completed',
    }]).state

    expect(completed.openItems).toEqual([])
    expect(completed.completed).toHaveLength(1)
    expect(completed.completed[0].key).toBe('p2-discovery')
  })

  it('persists only user-owned Project Memory and leaves verified technical facts in verified-fact memory', () => {
    const durable = durableProjectMemoryCandidates([
      { class: 'DECISION', key: 'a', value: 'A', source: 'user' },
      { class: 'PROJECT_FACT', key: 'b', value: 'B', source: 'verified_evidence', evidenceRefs: ['ev:b'] },
      { class: 'PROJECT_FACT', key: 'c', value: 'C', source: 'user' },
      { class: 'CORRECTION', key: 'd', value: 'D', source: 'user', correctionTarget: 'decision' },
      { class: 'CORRECTION', key: 'e', value: 'E', source: 'user', correctionTarget: 'progress' },
      { class: 'AI_HYPOTHESIS', key: 'f', value: 'F', source: 'assistant' },
      { class: 'PROGRESS', key: 'g', value: 'G', source: 'runtime', progressState: 'completed' },
    ])

    expect(durable.map(item => item.key)).toEqual(['a', 'c', 'd'])
  })
})
