import {
  executeExecutionTool,
  isExecutionTool,
  type AssistantExecutionAttachmentRef,
} from './executionTools.ts'
import type { AssistantToolExecution } from './assistantTools.ts'

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)
const ASSISTANT_FILES_BUCKET = 'assistant-files'

const asExecutionAttachment = (value: unknown): AssistantExecutionAttachmentRef | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const purpose = clean(item.purpose, 40)
  const attachmentId = clean(item.attachmentId, 200)
  const name = clean(item.name, 240)
  const mimeType = clean(item.mimeType, 160)
  const storageBucket = clean(item.storageBucket, 120)
  const storagePath = clean(item.storagePath, 1_000)
  if (purpose !== 'tool_input' || !attachmentId || !name || !storagePath || storageBucket !== ASSISTANT_FILES_BUCKET) return null
  if (!/\.xlsx$/i.test(name) && mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return null
  return { attachmentId, name, mimeType, storageBucket, storagePath }
}

async function loadWorkspaceExecutionAttachments(client: any, workspaceId: string) {
  const { data, error } = await client
    .from('messages')
    .select('attachments,created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(24)
  if (error) throw error

  const byId = new Map<string, AssistantExecutionAttachmentRef>()
  for (const row of data || []) {
    const attachments = Array.isArray(row.attachments) ? row.attachments : []
    for (const candidate of attachments) {
      const attachment = asExecutionAttachment(candidate)
      if (attachment && !byId.has(attachment.attachmentId)) byId.set(attachment.attachmentId, attachment)
    }
  }
  return [...byId.values()].slice(0, 12)
}

export async function executeSpreadsheetAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<AssistantToolExecution> {
  if (!isExecutionTool(toolName)) throw new Error(`Unknown spreadsheet execution tool: ${toolName}`)
  const attachments = await loadWorkspaceExecutionAttachments(client, workspaceId)
  if (!attachments.length) throw new Error('Bu çalışma alanında işlenebilir XLSX eki bulunamadı.')

  const execution = await executeExecutionTool({
    toolName,
    args,
    workspaceId,
    attachments,
    invoke: async request => {
      const { data, error } = await client.functions.invoke('spreadsheet-execute', { body: request })
      if (error) {
        let workerDetail = ''
        try {
          const context = (error as any)?.context
          const payload = context && typeof context.json === 'function' ? await context.json() : null
          workerDetail = clean(payload?.error || payload?.message, 2_000)
        } catch { /* best-effort worker error detail */ }
        throw new Error(workerDetail || clean((error as any)?.message, 2_000) || 'Spreadsheet worker çağrısı başarısız oldu.')
      }
      if (!data || typeof data !== 'object') throw new Error('Spreadsheet worker boş veya geçersiz sonuç döndürdü.')
      const result = data as Record<string, unknown>
      if (result.error) throw new Error(clean(result.error, 2_000))
      return result
    },
  })

  return {
    output: execution.output,
    sources: [],
    summary: {
      ...execution.summary,
      executionOnly: true,
      citationReady: false,
    },
  }
}
