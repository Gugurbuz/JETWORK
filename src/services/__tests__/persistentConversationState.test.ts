import { describe, expect, it } from 'vitest'
import { compactPersistentConversationState } from '../../../supabase/functions/_shared/persistentConversationState'
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine'

const planFor = (resolvedRequest: string): ReasoningPlan => ({
  intent: 'analysis',
  complexity: 'medium',
  goal: resolvedRequest,
  knowledgeRequired: false,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  conversationState: {
    continuation: true,
    topic: 'conversation quality',
    userMove: 'follow_up',
    priorIntent: 'analysis',
    rejectedHypotheses: [],
    retainedContext: [],
    openQuestions: [],
    resolvedRequest,
    activeEntities: ['Project Brain'],
    requestedEvidence: [],
    userDecisions: ['Raw history modele yığılmayacak'],
    verifiedFactRefs: [],
  },
})

describe('persistent conversation continuity cache', () => {
  it('keeps the active turn and an older relevant user constraint without retaining the raw transcript', () => {
    const items: Array<Record<string, unknown>> = [
      { role: 'user', content: 'JetWork kalite çalışmasında raw history modele yığılmayacak; Project Brain ayrı kalacak.' },
      { role: 'assistant', content: 'Bu kararı uygulayacağım.' },
    ]
    for (let index = 0; index < 30; index += 1) {
      items.push({ role: 'user', content: `alakasız-${index} ${'x'.repeat(500)}` })
      items.push({ role: 'assistant', content: `geçici-${index} ${'y'.repeat(500)}` })
    }
    items.push({ role: 'user', content: 'tamam kalite geliştirmelerine devam et' })
    items.push({ role: 'assistant', content: 'devam ediyorum' })

    const compacted = compactPersistentConversationState(
      items,
      planFor('JetWork kalite ve conversation context runtime geliştirmelerini tamamla'),
    )
    const serialized = JSON.stringify(compacted)

    expect(compacted.length).toBeLessThan(16)
    expect(serialized).toContain('raw history modele yığılmayacak')
    expect(serialized).toContain('tamam kalite geliştirmelerine devam et')
    expect(serialized).toContain('devam ediyorum')
    expect(serialized).not.toContain('alakasız-0')
  })

  it('does not truncate a large active user turn or final assistant response', () => {
    const activeUser = `aktif ${'u'.repeat(9_000)}`
    const finalAssistant = `final ${'a'.repeat(8_000)}`
    const items: Array<Record<string, unknown>> = []
    for (let index = 0; index < 20; index += 1) {
      items.push({ role: 'user', content: `history-${index} ${'x'.repeat(900)}` })
      items.push({ role: 'assistant', content: `answer-${index} ${'y'.repeat(900)}` })
    }
    items.push({ role: 'user', content: activeUser })
    items.push({ role: 'assistant', content: finalAssistant })

    const compacted = compactPersistentConversationState(items, planFor('aktif görev'))

    expect(compacted.at(-2)).toEqual({ role: 'user', content: activeUser })
    expect(compacted.at(-1)).toEqual({ role: 'assistant', content: finalAssistant })
  })
})
