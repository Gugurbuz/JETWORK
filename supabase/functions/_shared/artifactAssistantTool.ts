import {
  executeArtifactExecutionTool,
  isArtifactExecutionTool,
  type ActionAttachmentRef,
} from './artifactExecutionTools.ts'
import type { AssistantToolExecution } from './assistantTools.ts'

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)
const ASSISTANT_FILES_BUCKET = 'assistant-files'
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

export async function executeArtifactAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<AssistantToolExecution> {
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
      const { data, error } = await client.functions.invoke('artifact-execute', { body: request })
      if (error) {
        let detail = ''
        try {
          const context = (error as any)?.context
          const payload = context && typeof context.json === 'function' ? await context.json() : null
          detail = clean(payload?.error || payload?.message, 2_000)
        } catch { /* best effort */ }
        throw new Error(detail || clean((error as any)?.message, 2_000) || 'Artifact worker çağrısı başarısız oldu.')
      }
      if (!data || typeof data !== 'object') throw new Error('Artifact worker boş veya geçersiz sonuç döndürdü.')
      const result = data as Record<string, unknown>
      if (result.error) throw new Error(clean(result.error, 2_000))
      return result
    },
  })

  return {
    output: execution.output,
    sources: [],
    artifacts: execution.artifacts,
    summary: { ...execution.summary, executionOnly: true, citationReady: false },
  }
}
