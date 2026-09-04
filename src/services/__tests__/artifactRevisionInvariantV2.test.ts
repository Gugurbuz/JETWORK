import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_REVISION_INVARIANT_VERSION,
  verifyArtifactRevisionInvariant,
} from '../../../supabase/functions/_shared/artifact/revisionInvariant.ts'
import {
  artifactCompletionReady,
  newArtifactRuntimeSnapshot,
  transitionArtifactState,
} from '../../../supabase/functions/_shared/artifact/stateMachine.ts'

describe('artifact revision invariant v2', () => {
  it('allows only the explicitly targeted section to change', () => {
    const result = verifyArtifactRevisionInvariant({
      before: [
        { id: 'section-1', content: { title: 'Amaç', body: 'Aynı kalacak' } },
        { id: 'section-2', content: { title: 'Kapsam', body: 'Eski içerik' } },
        { id: 'section-3', content: { title: 'Kurallar', body: 'Aynı kalacak' } },
      ],
      after: [
        { id: 'section-1', content: { body: 'Aynı kalacak', title: 'Amaç' } },
        { id: 'section-2', content: { title: 'Kapsam', body: 'Yeni içerik' } },
        { id: 'section-3', content: { title: 'Kurallar', body: 'Aynı kalacak' } },
      ],
      allowedSectionIds: ['section-2'],
    })

    expect(result.version).toBe(ARTIFACT_REVISION_INVARIANT_VERSION)
    expect(result.ok).toBe(true)
    expect(result.changedSectionIds).toEqual(['section-2'])
    expect(result.unauthorizedChangedSectionIds).toEqual([])
  })

  it('fails closed when an untouched section changes or disappears', () => {
    const result = verifyArtifactRevisionInvariant({
      before: [
        { id: 'section-1', content: 'A' },
        { id: 'section-2', content: 'B' },
        { id: 'section-3', content: 'C' },
      ],
      after: [
        { id: 'section-1', content: 'A changed' },
        { id: 'section-2', content: 'B changed' },
      ],
      allowedSectionIds: ['section-2'],
    })

    expect(result.ok).toBe(false)
    expect(result.unauthorizedChangedSectionIds).toEqual(['section-1', 'section-3'])
    expect(result.missingSectionIds).toEqual(['section-3'])
  })

  it('blocks revision completion until invariant verification succeeds', () => {
    let snapshot = newArtifactRuntimeSnapshot({ artifactId: 'artifact-1', artifactVersion: 6, pendingRevision: true })
    snapshot = transitionArtifactState(snapshot, 'drafting')
    snapshot = transitionArtifactState(snapshot, 'validating')
    snapshot = transitionArtifactState(snapshot, 'executing')
    snapshot = transitionArtifactState(snapshot, 'verifying', { lastExecutorStatus: 'completed' })

    expect(() => transitionArtifactState(snapshot, 'persisted', {
      reloadVerified: true,
      integrityVerified: true,
      persisted: true,
    })).toThrow(/revision.*invariant/i)

    snapshot = transitionArtifactState(snapshot, 'persisted', {
      reloadVerified: true,
      integrityVerified: true,
      revisionInvariantVerified: true,
      persisted: true,
    })

    expect(artifactCompletionReady(snapshot)).toBe(true)
    snapshot = transitionArtifactState(snapshot, 'completed')
    expect(snapshot.state).toBe('completed')
  })
})
