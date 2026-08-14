export interface AssistantExecutionAttachmentRef {
  attachmentId: string
  name: string
  mimeType: string
  storageBucket: string
  storagePath: string
}

export interface AssistantGeneratedFileRef {
  attachmentId: string
  name: string
  mimeType: string
  storageBucket: string
  storagePath: string
}

export interface ExecutionToolResult {
  output: string
  artifacts: AssistantGeneratedFileRef[]
  summary: Record<string, unknown>
}

export interface SpreadsheetExecutionRequest {
  operation: 'inspect' | 'jira_sync'
  workspaceId: string
  input: AssistantExecutionAttachmentRef
  jiraInput?: AssistantExecutionAttachmentRef
  sheetName?: string | null
  jiraSheetName?: string | null
  config?: Record<string, unknown>
}

const EXECUTION_NOTICE = [
  'JETWORK_EXECUTION_RESULT.',
  'Bu çıktı JetWork dosya execution katmanının işlem sonucudur; kurumsal bilgi kanıtı veya citation değildir.',
  'Dosya içeriğinden gözlenen şema ve yapılan değişiklikleri görev sonucu olarak kullan; ayrı bir faktüel kaynak gibi cite etme.',
].join(' ')

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)

const requireAttachment = (
  attachmentId: unknown,
  attachments: AssistantExecutionAttachmentRef[],
): AssistantExecutionAttachmentRef => {
  const id = clean(attachmentId, 200)
  if (!id) throw new Error('attachmentId is required.')
  const attachment = attachments.find(candidate => candidate.attachmentId === id)
  if (!attachment) throw new Error(`Execution attachment not found: ${id}`)
  if (!/\.xlsx$/i.test(attachment.name) && attachment.mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    throw new Error(`Only XLSX execution attachments are supported: ${attachment.name}`)
  }
  return attachment
}

export const ASSISTANT_EXECUTION_TOOLS = [
  {
    type: 'function',
    name: 'inspect_spreadsheet_file',
    description: 'Inspect an attached XLSX action file before editing it. Returns worksheet names, dimensions, headers and bounded sample rows. This is execution context, not a citation source.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        sheetName: { type: ['string', 'null'], maxLength: 120 },
      },
      required: ['attachmentId', 'sheetName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'sync_spreadsheet_with_jira_export',
    description: 'Update a target XLSX from an attached Jira-export XLSX using explicit column mappings. Preserves existing workbook structure/styles where possible, writes completion status and latest sprint, validates the generated workbook, and returns a private output artifact.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        targetAttachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        jiraAttachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        targetSheetName: { type: ['string', 'null'], maxLength: 120 },
        jiraSheetName: { type: ['string', 'null'], maxLength: 120 },
        targetKeyColumn: { type: 'string', minLength: 1, maxLength: 160 },
        jiraKeyColumn: { type: 'string', minLength: 1, maxLength: 160 },
        jiraStatusColumn: { type: 'string', minLength: 1, maxLength: 160 },
        targetStatusColumn: { type: 'string', minLength: 1, maxLength: 160 },
        doneStatuses: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 80 } },
        completedValue: { type: 'string', minLength: 1, maxLength: 160 },
        jiraSprintColumn: { type: 'string', minLength: 1, maxLength: 160 },
        targetSprintColumn: { type: 'string', minLength: 1, maxLength: 160 },
        sprintNamePattern: { type: ['string', 'null'], maxLength: 120 },
        outputFileName: { type: ['string', 'null'], maxLength: 180 },
      },
      required: [
        'targetAttachmentId', 'jiraAttachmentId', 'targetSheetName', 'jiraSheetName',
        'targetKeyColumn', 'jiraKeyColumn', 'jiraStatusColumn', 'targetStatusColumn',
        'doneStatuses', 'completedValue', 'jiraSprintColumn', 'targetSprintColumn',
        'sprintNamePattern', 'outputFileName',
      ],
      additionalProperties: false,
    },
  },
] as const

export const isExecutionTool = (toolName: string) => (
  toolName === 'inspect_spreadsheet_file' || toolName === 'sync_spreadsheet_with_jira_export'
)

export async function executeExecutionTool(input: {
  toolName: string
  args: Record<string, unknown>
  workspaceId: string
  attachments: AssistantExecutionAttachmentRef[]
  invoke: (request: SpreadsheetExecutionRequest) => Promise<Record<string, unknown>>
}): Promise<ExecutionToolResult> {
  if (input.toolName === 'inspect_spreadsheet_file') {
    const attachment = requireAttachment(input.args.attachmentId, input.attachments)
    const result = await input.invoke({
      operation: 'inspect',
      workspaceId: input.workspaceId,
      input: attachment,
      sheetName: input.args.sheetName === null ? null : clean(input.args.sheetName, 120),
    })
    return {
      output: JSON.stringify({ securityNotice: EXECUTION_NOTICE, tool: input.toolName, result }),
      artifacts: [],
      summary: { executionOnly: true, citationReady: false, operation: 'inspect', attachmentId: attachment.attachmentId },
    }
  }

  if (input.toolName === 'sync_spreadsheet_with_jira_export') {
    const target = requireAttachment(input.args.targetAttachmentId, input.attachments)
    const jira = requireAttachment(input.args.jiraAttachmentId, input.attachments)
    const result = await input.invoke({
      operation: 'jira_sync',
      workspaceId: input.workspaceId,
      input: target,
      jiraInput: jira,
      sheetName: input.args.targetSheetName === null ? null : clean(input.args.targetSheetName, 120),
      jiraSheetName: input.args.jiraSheetName === null ? null : clean(input.args.jiraSheetName, 120),
      config: {
        targetKeyColumn: clean(input.args.targetKeyColumn, 160),
        jiraKeyColumn: clean(input.args.jiraKeyColumn, 160),
        jiraStatusColumn: clean(input.args.jiraStatusColumn, 160),
        targetStatusColumn: clean(input.args.targetStatusColumn, 160),
        doneStatuses: Array.isArray(input.args.doneStatuses) ? input.args.doneStatuses.map(value => clean(value, 80)).filter(Boolean).slice(0, 12) : [],
        completedValue: clean(input.args.completedValue, 160),
        jiraSprintColumn: clean(input.args.jiraSprintColumn, 160),
        targetSprintColumn: clean(input.args.targetSprintColumn, 160),
        sprintNamePattern: input.args.sprintNamePattern === null ? null : clean(input.args.sprintNamePattern, 120),
        outputFileName: input.args.outputFileName === null ? null : clean(input.args.outputFileName, 180),
      },
    })
    const artifactValue = result.artifact
    const artifact = artifactValue && typeof artifactValue === 'object'
      ? artifactValue as Record<string, unknown>
      : null
    const artifacts: AssistantGeneratedFileRef[] = artifact?.storagePath
      ? [{
          attachmentId: clean(artifact.attachmentId || crypto.randomUUID(), 200),
          name: clean(artifact.name || 'jetwork-output.xlsx', 240),
          mimeType: clean(artifact.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 160),
          storageBucket: clean(artifact.storageBucket || 'assistant-files', 120),
          storagePath: clean(artifact.storagePath, 1_000),
        }]
      : []
    return {
      output: JSON.stringify({ securityNotice: EXECUTION_NOTICE, tool: input.toolName, result }),
      artifacts,
      summary: {
        executionOnly: true,
        citationReady: false,
        operation: 'jira_sync',
        targetAttachmentId: target.attachmentId,
        jiraAttachmentId: jira.attachmentId,
        artifactCount: artifacts.length,
        ...(result.summary && typeof result.summary === 'object' ? result.summary as Record<string, unknown> : {}),
      },
    }
  }

  throw new Error(`Unknown execution tool: ${input.toolName}`)
}
