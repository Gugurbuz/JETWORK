import { describe, expect, it } from 'vitest'
import {
  applyControllerCoverageProposal,
  createEvidenceRuntimeLedger,
  evidenceLedgerObservation,
  recordVerifiedToolEvidence,
  recordVerifiedWebEvidence,
} from '../../../supabase/functions/_shared/evidence/runtimeLedger.ts'

describe('evidence runtime ledger v2', () => {
  it('records only citation-ready knowledge sources and never invents semantic supports', () => {
    const empty = createEvidenceRuntimeLedger('ZCRM2-586 neden oluşur?')
    const ignored = recordVerifiedToolEvidence(empty, {
      output: '{}',
      sources: [{ sourceId: 's1', sourceName: 'Candidate', canonicalKey: 'message:zcrm2-586' }],
      summary: { citationReady: false },
    })
    expect(ignored.map.evidence).toHaveLength(0)

    const ledger = recordVerifiedToolEvidence(empty, {
      output: '{}',
      sources: [{ sourceId: 's1', sourceName: 'CRM Message Catalog', canonicalKey: 'message:zcrm2-586' }],
      summary: { citationReady: true },
    })
    expect(ledger.map.evidence).toHaveLength(1)
    expect(ledger.map.evidence[0].trustLevel).toBe('published-enterprise-source')
    expect(ledger.map.evidence[0].supports).toEqual([])
  })

  it('accepts only real web URLs as verified public evidence', () => {
    const ledger = recordVerifiedWebEvidence(createEvidenceRuntimeLedger('current info'), [
      { sourceName: 'Bad', sourceType: 'web' },
      { sourceName: 'Official', sourceType: 'web', url: 'https://example.com/current' },
    ])
    expect(ledger.map.evidence).toHaveLength(1)
    expect(ledger.map.evidence[0]).toMatchObject({ sourceType: 'web', trustLevel: 'verified-public-source' })
  })

  it('mechanically rejects controller coverage claims that cite no existing evidence', () => {
    const ledger = createEvidenceRuntimeLedger('question')
    const proposed = applyControllerCoverageProposal(ledger, {
      aspects: [{ id: 'cause', label: 'root cause', evidenceIds: ['invented-evidence'], status: 'covered' }],
    })
    expect(proposed.map.aspects[0]).toMatchObject({ evidenceIds: [], status: 'open' })
    const observation = evidenceLedgerObservation(proposed)
    expect(observation.critic.controllerDecisionRequired).toBe(true)
    expect(observation.critic.gaps).toContain('root cause: no verified evidence')
  })

  it('critic observation never selects a tool or finalizes the answer', () => {
    const observation = evidenceLedgerObservation(createEvidenceRuntimeLedger('question')) as unknown as Record<string, unknown>
    const serialized = JSON.stringify(observation)
    expect(serialized).not.toContain('toolName')
    expect(serialized).not.toContain('forceSynthesis')
    expect(serialized).not.toContain('finalize')
  })
})
