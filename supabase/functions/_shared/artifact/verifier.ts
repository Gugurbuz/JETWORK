import type { AssistantGeneratedFileRef } from '../executionTools.ts'

export const ARTIFACT_VERIFIER_VERSION = 'artifact-verifier-v2'

export interface ArtifactReloadObservation {
  attachmentId: string
  name: string
  mimeType: string
  storageBucket: string
  storagePath: string
  byteSize?: number
  sha256?: string
}

export interface ArtifactVerificationResult {
  version: typeof ARTIFACT_VERIFIER_VERSION
  reloadVerified: boolean
  integrityVerified: boolean
  failures: string[]
  artifacts: ArtifactReloadObservation[]
}

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)

/**
 * Mechanical verifier only. It does not judge artifact quality or content semantics.
 * The caller supplies a trusted reload function that re-reads persisted artifact metadata.
 */
export async function verifyGeneratedArtifacts(input: {
  generated: readonly AssistantGeneratedFileRef[]
  reload: (artifact: AssistantGeneratedFileRef) => Promise<ArtifactReloadObservation | null>
}): Promise<ArtifactVerificationResult> {
  const failures: string[] = []
  const observations: ArtifactReloadObservation[] = []

  if (!input.generated.length) {
    return {
      version: ARTIFACT_VERIFIER_VERSION,
      reloadVerified: false,
      integrityVerified: false,
      failures: ['artifact_missing'],
      artifacts: [],
    }
  }

  for (const artifact of input.generated) {
    const reloaded = await input.reload(artifact).catch(() => null)
    if (!reloaded) {
      failures.push(`reload_failed:${clean(artifact.attachmentId, 200) || clean(artifact.name, 240)}`)
      continue
    }
    observations.push(reloaded)

    if (clean(reloaded.storageBucket, 120) !== clean(artifact.storageBucket, 120)) failures.push(`bucket_mismatch:${artifact.attachmentId}`)
    if (clean(reloaded.storagePath) !== clean(artifact.storagePath)) failures.push(`path_mismatch:${artifact.attachmentId}`)
    if (clean(reloaded.name, 240) !== clean(artifact.name, 240)) failures.push(`name_mismatch:${artifact.attachmentId}`)
    if (!clean(reloaded.mimeType, 160)) failures.push(`mime_missing:${artifact.attachmentId}`)
    if (reloaded.byteSize !== undefined && (!Number.isFinite(reloaded.byteSize) || reloaded.byteSize <= 0)) failures.push(`empty_artifact:${artifact.attachmentId}`)
    if (reloaded.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(clean(reloaded.sha256, 128))) failures.push(`sha256_invalid:${artifact.attachmentId}`)
  }

  const reloadVerified = observations.length === input.generated.length
  return {
    version: ARTIFACT_VERIFIER_VERSION,
    reloadVerified,
    integrityVerified: reloadVerified && failures.length === 0,
    failures,
    artifacts: observations,
  }
}
