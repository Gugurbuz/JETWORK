import type { AssistantGeneratedFileRef } from '../executionTools.ts'
import {
  verifyGeneratedArtifacts,
  type ArtifactVerificationResult,
} from './verifier.ts'

const sha256Bytes = async (bytes: Uint8Array) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Re-load generated outputs from private Supabase Storage before any caller may
 * treat the artifact as complete. This is a mechanical persistence/integrity
 * guard only; semantic document quality stays with the controller/evaluation layer.
 */
export async function verifyPersistedArtifactOutputs(
  client: any,
  artifacts: readonly AssistantGeneratedFileRef[],
): Promise<ArtifactVerificationResult> {
  return verifyGeneratedArtifacts({
    generated: artifacts,
    reload: async artifact => {
      if (!artifact.storageBucket || !artifact.storagePath) return null
      const { data, error } = await client.storage
        .from(artifact.storageBucket)
        .download(artifact.storagePath)
      if (error || !data) return null
      const bytes = new Uint8Array(await data.arrayBuffer())
      return {
        attachmentId: artifact.attachmentId,
        name: artifact.name,
        mimeType: artifact.mimeType,
        storageBucket: artifact.storageBucket,
        storagePath: artifact.storagePath,
        byteSize: bytes.byteLength,
        sha256: await sha256Bytes(bytes),
      }
    },
  })
}

export async function requireVerifiedArtifactOutputs(
  client: any,
  artifacts: readonly AssistantGeneratedFileRef[],
): Promise<ArtifactVerificationResult> {
  const verification = await verifyPersistedArtifactOutputs(client, artifacts)
  if (!verification.reloadVerified || !verification.integrityVerified) {
    throw new Error(`ARTIFACT_VERIFICATION_FAILED:${verification.failures.join(',') || 'unknown'}`)
  }
  return verification
}
