import {
  executeArtifactExecutionTool,
  isArtifactExecutionTool,
  type ActionAttachmentRef,
} from './artifactExecutionTools.ts'
import type { AssistantGeneratedFileRef } from './executionTools.ts'
import { requireVerifiedArtifactOutputs } from './artifact/storageVerifier.ts'
import { verifyOfficeRevisionInvariant } from './artifact/officeRevisionVerifier.ts'

export interface ArtifactAssistantToolExecution {
  output: string
  sources: []
  summary: Record<string, unknown>
  artifacts?: AssistantGeneratedFileRef[]
}

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)
const ASSISTANT_FILES_BUCKET = 'assistant-files'
const OUTPUT_ARTIFACT_TOOLS = new Set([
  'transform_pdf_file',
  'edit_office_file',
  'create_document_file',
  'generate_or_edit_image',
])
const ACTIONABLE_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png','image/jpeg','image/webp','image/gif','image/svg+xml',
  'text/csv','text/tab-separated-values','text/plain','text/markdown','application/json',
])
const ACTIONABLE_EXT = /\.(xlsx|pdf|docx|pptx|png|jpe?g|webp|gif|svg|csv|tsv|txt|md|json)$/i

const asActionAttachment = (value: unknown): ActionAttachmentRef | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const purpose = clean(item.purpose, 40)
  const attachmentId = clean(item.attachmentId, 200)
  const name = clean(item.name, 240)
  const mimeType = clean(item.mimeType, 160).toLocaleLowerCase('en-US')
  const storageBucket = clean(item.storageBucket, 120)
  const storagePath = clean(item.storagePath, 1_000)
  if (purpose !== 'tool_input' || !attachmentId || !name || !storagePath || storageBucket !== ASSISTANT_FILES_BUCKET) return null
  if (!ACTIONABLE_EXT.test(name) && !ACTIONABLE_MIMES.has(mimeType)) return null
  return { attachmentId, name, mimeType, storageBucket, storagePath }
}

async function loadWorkspaceActionAttachments(client: any, workspaceId: string) {
  const { data, error } = await client
    .from('messages')
    .select('attachments,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(24)
  if (error) throw error
  const byId = new Map<string, ActionAttachmentRef>()
  for (const row of data || []) {
    const attachments = Array.isArray(row.attachments) ? row.attachments : []
    for (const candidate of attachments) {
      const attachment = asActionAttachment(candidate)
      if (attachment && !byId.has(attachment.attachmentId)) byId.set(attachment.attachmentId, attachment)
    }
  }
  return [...byId.values()].slice(0, 20)
}

const artifactExecutorSlug = (request: { operation?: string; config?: Record<string, unknown> }) => (
  request.operation === 'document_create'
  && clean(request.config?.format, 10).toLocaleLowerCase('en-US') === 'docx'
    ? 'docx-execute'
    : 'artifact-execute'
)

async function inspectOfficeRef(client: any, workspaceId: string, ref: ActionAttachmentRef | AssistantGeneratedFileRef) {
  const { data, error } = await client.functions.invoke('artifact-execute', {
    body: { operation: 'inspect', workspaceId, input: ref },
  })
  if (error) throw new Error(clean((error as any)?.message, 1_000) || 'Office revision inspect failed.')
  if (!data || typeof data !== 'object') throw new Error('Office revision inspect returned an invalid payload.')
  const payload = data as Record<string, unknown>
  if (payload.error) throw new Error(clean(payload.error, 1_000))
  if (!payload.inspection) throw new Error('Office revision inspect returned no inspection payload.')
  return payload.inspection
}

async function removeGeneratedArtifact(client: any, artifact: AssistantGeneratedFileRef | undefined) {
  if (!artifact?.storageBucket || !artifact?.storagePath) return
  await client.storage.from(artifact.storageBucket).remove([artifact.storagePath]).catch(() => undefined)
}

export async function executeArtifactAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ArtifactAssistantToolExecution> {
  if (!isArtifactExecutionTool(toolName)) throw new Error(`Unknown artifact execution tool: ${toolName}`)
  const attachments = await loadWorkspaceActionAttachments(client, workspaceId)
  const requiresExistingFile = ['inspect_file_attachment', 'transform_pdf_file', 'edit_office_file'].includes(toolName)
    || (toolName === 'generate_or_edit_image' && clean(args.mode, 20) === 'edit')
  if (requiresExistingFile && !attachments.length) throw new Error('Bu çalışma alanında işlenebilir action dosyası bulunamadı.')

  const execution = await executeArtifactExecutionTool({
    toolName,
    args,
    workspaceId,
    attachments,
    invoke: async request => {
      const functionSlug = artifactExecutorSlug(request)
      const { data, error } = await client.functions.invoke(functionSlug, { body: request })
      if (error) {
        let detail = ''
        try {
          const context = (error as any)?.context
          const payload = context && typeof context.json === 'function' ? await context.json() : null
          detail = clean(payload?.error || payload?.message, 2_000)
        } catch { /* best effort */ }
        throw new Error(detail || clean((error as any)?.message, 2_000) || `${functionSlug} çağrısı başarısız oldu.`)
      }
      if (!data || typeof data !== 'object') throw new Error(`${functionSlug} boş veya geçersiz sonuç döndürdü.`)
      const result = data as Record<string, unknown>
      if (result.error) throw new Error(clean(result.error, 2_000))
      return result
    },
  })

  const requiresOutputArtifact = OUTPUT_ARTIFACT_TOOLS.has(toolName)
  if (requiresOutputArtifact && !execution.artifacts.length) {
    throw new Error(`ARTIFACT_EXECUTOR_RETURNED_NO_OUTPUT:${toolName}`)
  }
  const artifactVerification = requiresOutputArtifact
    ? await requireVerifiedArtifactOutputs(client, execution.artifacts)
    : null

  let officeRevisionVerification: ReturnType<typeof verifyOfficeRevisionInvariant> | null = null
  if (toolName === 'edit_office_file') {
    const sourceAttachmentId = clean(args.attachmentId, 200)
    const sourceRef = attachments.find(item => item.attachmentId === sourceAttachmentId)
    const outputRef = execution.artifacts[0]
    if (!sourceRef || !outputRef) {
      await removeGeneratedArtifact(client, outputRef)
      throw new Error('ARTIFACT_REVISION_INVARIANT_INPUT_MISSING')
    }

    try {
      const [beforeInspection, afterInspection] = await Promise.all([
        inspectOfficeRef(client, workspaceId, sourceRef),
        inspectOfficeRef(client, workspaceId, outputRef),
      ])
      officeRevisionVerification = verifyOfficeRevisionInvariant({
        beforeInspection,
        afterInspection,
        operation: clean(args.operation, 30),
        findText: args.findText === null ? null : String(args.findText || ''),
        replacementText: args.replacementText === null ? null : String(args.replacementText || ''),
      })
      if (!officeRevisionVerification.verified) {
        throw new Error(`ARTIFACT_REVISION_INVARIANT_FAILED:${officeRevisionVerification.failures.join(',')}`)
      }
    } catch (error) {
      await removeGeneratedArtifact(client, outputRef)
      throw error
    }
  }

  return {
    output: execution.output,
    sources: [],
    artifacts: execution.artifacts,
    summary: {
      ...execution.summary,
      executionOnly: true,
      citationReady: false,
      artifactVerification: artifactVerification ? {
        version: artifactVerification.version,
        reloadVerified: artifactVerification.reloadVerified,
        integrityVerified: artifactVerification.integrityVerified,
        artifactCount: artifactVerification.artifacts.length,
        revisionInvariantVerified: officeRevisionVerification?.verified ?? null,
      } : null,
      officeRevisionVerification,
    },
  }
}
