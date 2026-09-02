import { describe, expect, it } from 'vitest'
import { createEvidenceControllerSession } from '../../../supabase/functions/_shared/evidence/controllerSession.ts'

describe('evidence controller session v2', () => {
  it('collects only mechanically verified evidence and keeps coverage semantic ownership with the controller', () => {
    const session = createEvidenceControllerSession('CHECK_ZTKS hangi mesajları üretir ve koşulları nedir?')

    session.recordToolResult({
      output: 'verified',
      records: [],
      sources: [{
        sourceId: 'src-1',
        sourceName: 'CHECK_ZTKS source',
        canonicalKey: 'method:check_ztks',
        title: 'CHECK_ZTKS',
      }],
      summary: { citationReady: true },
    } as any)

    const evidenceId = session.observation().evidence[0]?.id
    expect(evidenceId).toMatch(/^ev_/)

    session.applyCoverageProposal({
      aspects: [
        { id: 'messages', label: 'Mesajlar', evidenceIds: [evidenceId], status: 'covered' },
        { id: 'condition-545', label: '545 koşulu', evidenceIds: ['ev_fake'], status: 'covered' },
      ],
    })

    const observation = session.observation()
    expect(observation.aspects.find(item => item.id === 'messages')?.status).toBe('covered')
    expect(observation.aspects.find(item => item.id === 'condition-545')?.status).toBe('open')
    expect(observation.critic.controllerDecisionRequired).toBe(true)
  })

  it('ignores web records without a real URL', () => {
    const session = createEvidenceControllerSession('Güncel bilgi nedir?')
    session.recordWebSources([
      { sourceType: 'web', sourceName: 'No URL', title: 'No URL' },
      { sourceType: 'web', sourceName: 'Official', title: 'Official', url: 'https://example.com/source' },
    ] as any)

    const observation = session.observation()
    expect(observation.evidence).toHaveLength(1)
    expect(observation.evidence[0].source).toBe('https://example.com/source')
  })
})
