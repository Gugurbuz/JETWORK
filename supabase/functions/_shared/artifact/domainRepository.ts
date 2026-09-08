import type { AssistantGeneratedFileRef } from '../executionTools.ts'
import type { ArtifactVerificationResult } from './verifier.ts'
import {
  newArtifactRuntimeSnapshot,
  transitionArtifactState,
  type ArtifactRuntimeSnapshot,
} from './stateMachine.ts'

export interface CanonicalArtifactFileRef extends AssistantGeneratedFileRef {
  artifactId: string
  artifactVersion: number
  artifactType: string
  artifactState: 'completed'
  byteSize?: number
  sha256?: string
  createdAt: string
  supersedesVersion?: number
}

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)

const artifactTypeOf = (file: AssistantGeneratedFileRef) => {
  const ext = clean(file.name, 240).split('.').pop()?.toLocaleLowerCase('en-US') || ''
  if (ext === 'docx' || file.mimeType.includes('wordprocessingml')) return 'document'
  if (ext === 'xlsx' || file.mimeType.includes('spreadsheet')) return 'spreadsheet'
  if (ext === 'pptx' || file.mimeType.includes('presentation')) return 'presentation'
  if (ext === 'pdf' || file.mimeType === 'application/pdf') return 'pdf'
  if (file.mimeType.startsWith('image/')) return 'image'
  return 'file'
}

const completedSnapshot = (input: {
  artifactId?: string
  artifactVersion?: number
  artifactType: string
  pendingRevision: boolean
  revisionInvariantVerified: boolean
  verification: ArtifactVerificationResult
}): ArtifactRuntimeSnapshot => {
  let snapshot = newArtifactRuntimeSnapshot({
    artifactId: input.artifactId,
    artifactVersion: input.artifactVersion,
    artifactType: input.artifactType,
    pendingRevision: input.pendingRevision,
  })
  snapshot = transitionArtifactState(snapshot, 'drafting')
  snapshot = transitionArtifactState(snapshot, 'validating')
  snapshot = transitionArtifactState(snapshot, 'executing', {
    lastExecutorStatus: 'completed',
    revisionInvariantVerified: input.pendingRevision ? input.revisionInvariantVerified : true,
  })
  snapshot = transitionArtifactState(snapshot, 'verifying', {
    reloadVerified: input.verification.reloadVerified,
    integrityVerified: input.verification.integrityVerified,
  })
  snapshot = transitionArtifactState(snapshot, 'persisted', { persisted: true })
  return transitionArtifactState(snapshot, 'completed')
}

async function sourceArtifactContext(client: any, workspaceId: string, sourceAttachmentId: string) {
  if (!sourceAttachmentId) return { artifactId: null as string | null, version: null as number | null }
  const { data, error } = await client
    .from('workspace_files')
    .select('artifact_id,artifact_version')
    .eq('workspace_id', workspaceId)
    .eq('attachment_id', sourceAttachmentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`ARTIFACT_SOURCE_LOOKUP_FAILED:${clean(error.message, 500)}`)
  return {
    artifactId: data?.artifact_id ? String(data.artifact_id) : null,
    version: Number.isFinite(Number(data?.artifact_version)) ? Number(data.artifact_version) : null,
  }
}

const sourceAttachmentIdFor = (toolName: string, args: Record<string, unknown>) => {
  if (toolName === 'sync_spreadsheet_with_jira_export') return clean(args.targetAttachmentId, 200)
  return clean(args.attachmentId, 200)
}

/**
 * Persistence boundary for outputs that have already passed executor + storage reload/integrity QA.
 * It never marks an artifact completed before those mechanical guards pass.
 */
export async function persistVerifiedArtifactOutputs(input: {
  client: any
  workspaceId: string
  toolName: string
  args: Record<string, unknown>
  artifacts: readonly AssistantGeneratedFileRef[]
  verification: ArtifactVerificationResult
  revisionInvariantVerified?: boolean | null
  evidenceRefs?: string[]
  sourceMessageId?: string | null
}): Promise<CanonicalArtifactFileRef[]> {
  if (!input.artifacts.length) return []
  if (!input.verification.reloadVerified || !input.verification.integrityVerified) {
    throw new Error('ARTIFACT_PERSISTENCE_REJECTED_BEFORE_VERIFICATION')
  }

  const sourceAttachmentId = sourceAttachmentIdFor(input.toolName, input.args)
  const source = await sourceArtifactContext(input.client, input.workspaceId, sourceAttachmentId)
  const isOfficeRevision = input.toolName === 'edit_office_file'
  if (isOfficeRevision && input.revisionInvariantVerified !== true) {
    throw new Error('ARTIFACT_PERSISTENCE_REJECTED_BEFORE_REVISION_INVARIANT')
  }

  const observationByAttachment = new Map(
    input.verification.artifacts.map(item => [item.attachmentId, item] as const),
  )
  const createdAt = new Date().toISOString()
  const results: CanonicalArtifactFileRef[] = []

  for (const [index, artifact] of input.artifacts.entries()) {
    const observation = observationByAttachment.get(artifact.attachmentId)
    if (!observation) throw new Error(`ARTIFACT_VERIFIED_OBSERVATION_MISSING:${artifact.attachmentId}`)
    const artifactType = artifactTypeOf(artifact)

    // The state machine is used here as a completion gate, not as UI theater. Earlier
    // research/drafting states are not emitted retroactively; live UI is driven only by
    // real Agent Work events. This verifies that completion invariants are satisfied.
    completedSnapshot({
      artifactId: source.artifactId || undefined,
      artifactVersion: source.version ? source.version + 1 : 1,
      artifactType,
      pendingRevision: isOfficeRevision,
      revisionInvariantVerified: input.revisionInvariantVerified === true,
      verification: input.verification,
    })

    const { data, error } = await input.client.rpc('persist_completed_artifact_v2', {
      p_workspace_id: input.workspaceId,
      p_existing_artifact_id: index === 0 ? source.artifactId : null,
      p_artifact_type: artifactType,
      p_title: clean(artifact.name, 240) || 'JetWork çıktısı',
      p_attachment_id: artifact.attachmentId,
      p_filename: clean(artifact.name, 240) || 'jetwork-output',
      p_mime_type: clean(artifact.mimeType, 160) || 'application/octet-stream',
      p_storage_bucket: artifact.storageBucket,
      p_storage_path: artifact.storagePath,
      p_byte_size: Number.isFinite(Number(observation.byteSize)) ? Number(observation.byteSize) : null,
      p_sha256: clean(observation.sha256, 128) || null,
      p_evidence_refs: [...new Set(input.evidenceRefs || [])],
      p_source_message_id: input.sourceMessageId || null,
    })
    if (error) throw new Error(`ARTIFACT_PERSISTENCE_FAILED:${clean(error.message, 1_000)}`)

    const row = Array.isArray(data) ? data[0] : data
    const artifactId = clean(row?.artifact_id, 80)
    const artifactVersion = Number(row?.artifact_version)
    if (!artifactId || !Number.isFinite(artifactVersion) || artifactVersion < 1) {
      throw new Error('ARTIFACT_PERSISTENCE_RETURNED_INVALID_IDENTITY')
    }

    results.push({
      ...artifact,
      artifactId,
      artifactVersion,
      artifactType,
      artifactState: 'completed',
      byteSize: observation.byteSize,
      sha256: observation.sha256,
      createdAt,
      supersedesVersion: artifactVersion > 1 ? artifactVersion - 1 : undefined,
    })
  }

  return results
}
