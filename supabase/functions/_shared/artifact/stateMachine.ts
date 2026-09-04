export const ARTIFACT_STATE_MACHINE_VERSION = 'artifact-state-machine-v2'

export type ArtifactRuntimeState =
  | 'requested'
  | 'researching'
  | 'drafting'
  | 'validating'
  | 'executing'
  | 'verifying'
  | 'persisted'
  | 'completed'
  | 'executor_failed'
  | 'verification_failed'
  | 'persistence_failed'

export interface ArtifactRuntimeSnapshot {
  version: typeof ARTIFACT_STATE_MACHINE_VERSION
  artifactId?: string
  artifactVersion?: number
  artifactType?: string
  state: ArtifactRuntimeState
  pendingRevision?: boolean
  userApprovedSections: string[]
  evidenceRefs: string[]
  lastExecutorStatus?: 'not_started' | 'completed' | 'failed'
  reloadVerified: boolean
  integrityVerified: boolean
  revisionInvariantVerified: boolean
  persisted: boolean
}

const transitions: Record<ArtifactRuntimeState, readonly ArtifactRuntimeState[]> = {
  requested: ['researching','drafting'],
  researching: ['drafting'],
  drafting: ['validating'],
  validating: ['executing'],
  executing: ['verifying','executor_failed'],
  verifying: ['persisted','verification_failed'],
  persisted: ['completed','persistence_failed'],
  completed: [],
  executor_failed: [],
  verification_failed: [],
  persistence_failed: [],
}

export const newArtifactRuntimeSnapshot = (input: {
  artifactId?: string
  artifactVersion?: number
  artifactType?: string
  evidenceRefs?: string[]
  pendingRevision?: boolean
} = {}): ArtifactRuntimeSnapshot => ({
  version: ARTIFACT_STATE_MACHINE_VERSION,
  artifactId: input.artifactId,
  artifactVersion: input.artifactVersion,
  artifactType: input.artifactType,
  state: 'requested',
  pendingRevision: input.pendingRevision === true,
  userApprovedSections: [],
  evidenceRefs: [...new Set(input.evidenceRefs || [])],
  lastExecutorStatus: 'not_started',
  reloadVerified: false,
  integrityVerified: false,
  revisionInvariantVerified: input.pendingRevision === true ? false : true,
  persisted: false,
})

export const canTransitionArtifactState = (
  from: ArtifactRuntimeState,
  to: ArtifactRuntimeState,
) => transitions[from].includes(to)

const revisionInvariantSatisfied = (snapshot: ArtifactRuntimeSnapshot) => (
  snapshot.pendingRevision !== true || snapshot.revisionInvariantVerified === true
)

export const transitionArtifactState = (
  snapshot: ArtifactRuntimeSnapshot,
  to: ArtifactRuntimeState,
  patch: Partial<Omit<ArtifactRuntimeSnapshot, 'version'|'state'>> = {},
): ArtifactRuntimeSnapshot => {
  if (!canTransitionArtifactState(snapshot.state, to)) {
    throw new Error(`Invalid artifact transition: ${snapshot.state} -> ${to}`)
  }

  const next: ArtifactRuntimeSnapshot = { ...snapshot, ...patch, state: to, version: ARTIFACT_STATE_MACHINE_VERSION }

  if (to === 'verifying' && next.lastExecutorStatus !== 'completed') {
    throw new Error('Artifact cannot enter verifying before executor completion.')
  }
  if (to === 'persisted' && (!next.reloadVerified || !next.integrityVerified)) {
    throw new Error('Artifact cannot be persisted before reload and integrity verification.')
  }
  if (to === 'persisted' && !revisionInvariantSatisfied(next)) {
    throw new Error('Artifact revision cannot be persisted before unchanged-section invariant verification.')
  }
  if (to === 'completed' && (!next.persisted || !next.reloadVerified || !next.integrityVerified || next.lastExecutorStatus !== 'completed')) {
    throw new Error('Artifact cannot be completed without executor, reload/integrity verification, and persistence.')
  }
  if (to === 'completed' && !revisionInvariantSatisfied(next)) {
    throw new Error('Artifact revision cannot be completed before unchanged-section invariant verification.')
  }

  return next
}

export const artifactCompletionReady = (snapshot: ArtifactRuntimeSnapshot) => (
  snapshot.state === 'persisted'
  && snapshot.lastExecutorStatus === 'completed'
  && snapshot.reloadVerified
  && snapshot.integrityVerified
  && revisionInvariantSatisfied(snapshot)
  && snapshot.persisted
)
