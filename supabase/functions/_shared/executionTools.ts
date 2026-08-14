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
  operation: 'inspect' | 'edit' | 'transform' | 'create' | 'validate' | 'jira_sync'
  workspaceId: string
  input?: AssistantExecutionAttachmentRef
  secondaryInput?: AssistantExecutionAttachmentRef
  jiraInput?: AssistantExecutionAttachmentRef
  sheetName?: string | null
  secondarySheetName?: string | null
  jiraSheetName?: string | null
  config?: Record<string, unknown>
}

const EXECUTION_NOTICE = [
  'JETWORK_EXECUTION_RESULT.',
  'Bu çıktı JetWork dosya execution katmanının işlem sonucudur; kurumsal bilgi kanıtı veya citation değildir.',
  'Dosya içeriğinden gözlenen şema ve yapılan değişiklikleri görev sonucu olarak kullan; ayrı bir faktüel kaynak gibi cite etme.',
].join(' ')

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const requireAttachment = (
  attachmentId: unknown,
  attachments: AssistantExecutionAttachmentRef[],
): AssistantExecutionAttachmentRef => {
  const id = clean(attachmentId, 200)
  if (!id) throw new Error('attachmentId is required.')
  const attachment = attachments.find(candidate => candidate.attachmentId === id)
  if (!attachment) throw new Error(`Execution attachment not found: ${id}`)
  if (!/\.xlsx$/i.test(attachment.name) && attachment.mimeType !== XLSX_MIME) {
    throw new Error(`Only XLSX execution attachments are supported: ${attachment.name}`)
  }
  return attachment
}

const nullableText = (maxLength: number) => ({ type: ['string', 'null'], maxLength })
const nullableNumber = (minimum: number, maximum: number) => ({ type: ['number', 'null'], minimum, maximum })

const artifactResult = (
  toolName: string,
  operation: string,
  result: Record<string, unknown>,
  extraSummary: Record<string, unknown> = {},
): ExecutionToolResult => {
  const artifactValue = result.artifact
  const artifact = artifactValue && typeof artifactValue === 'object'
    ? artifactValue as Record<string, unknown>
    : null
  const artifacts: AssistantGeneratedFileRef[] = artifact?.storagePath
    ? [{
        attachmentId: clean(artifact.attachmentId || crypto.randomUUID(), 200),
        name: clean(artifact.name || 'jetwork-output.xlsx', 240),
        mimeType: clean(artifact.mimeType || XLSX_MIME, 160),
        storageBucket: clean(artifact.storageBucket || 'assistant-files', 120),
        storagePath: clean(artifact.storagePath, 1_000),
      }]
    : []
  const { artifact: _artifact, signedUrl: _signedUrl, storagePath: _storagePath, ...resultWithoutPrivateArtifact } = result
  const modelArtifact = artifact
    ? {
        attachmentId: clean(artifact.attachmentId, 200),
        name: clean(artifact.name || 'jetwork-output.xlsx', 240),
        mimeType: clean(artifact.mimeType || XLSX_MIME, 160),
        byteSize: Number(artifact.byteSize || 0),
        sha256: clean(artifact.sha256, 128),
      }
    : null
  return {
    output: JSON.stringify({
      securityNotice: EXECUTION_NOTICE,
      tool: toolName,
      result: { ...resultWithoutPrivateArtifact, artifact: modelArtifact },
    }),
    artifacts,
    summary: {
      executionOnly: true,
      citationReady: false,
      operation,
      artifactCount: artifacts.length,
      ...(result.summary && typeof result.summary === 'object' ? result.summary as Record<string, unknown> : {}),
      ...extraSummary,
    },
  }
}

export const ASSISTANT_EXECUTION_TOOLS = [
  {
    type: 'function',
    name: 'list_spreadsheet_attachments',
    description: 'List recent XLSX action attachments available in the active workspace. Use this first for spreadsheet tasks. If records are returned, the files are available: never tell the user they are missing; do not claim files are missing. This result is execution context, not evidence.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'inspect_spreadsheet_file',
    description: 'Inspect one XLSX action attachment before editing it. Returns worksheet names, dimensions, headers and bounded sample rows. Use the real sheet/header names from this result instead of guessing.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        sheetName: nullableText(120),
      },
      required: ['attachmentId', 'sheetName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'edit_spreadsheet_file',
    description: 'Apply allow-listed workbook edits to an attached XLSX and return a new XLSX artifact. Use for direct value, formula, fill color, bold, font size, merge, filter, freeze-pane and add-sheet edits such as \"tüm satırları kırmızıya boya\". Inspect first when the target sheet/range is not already known. set_fill uses value as a color name or hex; set_formula uses value as formula text; set_bold makes the target bold; set_font_size uses number; merge/filter/freeze use target; add_sheet uses value.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        sheetName: nullableText(120),
        actions: {
          type: 'array', minItems: 1, maxItems: 50,
          items: {
            type: 'object',
            properties: {
              operation: { type: 'string', enum: ['set_value','set_formula','set_fill','set_bold','set_font_size','merge_cells','add_filter','freeze_panes','add_sheet'] },
              target: nullableText(120),
              value: { type: ['string','number','boolean','null'], maxLength: 2_000 },
              number: nullableNumber(0, 1_000),
            },
            required: ['operation','target','value','number'],
            additionalProperties: false,
          },
        },
        outputFileName: nullableText(180),
      },
      required: ['attachmentId','sheetName','actions','outputFileName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'transform_spreadsheet_file',
    description: 'Run a deterministic table transformation and return a new XLSX artifact. Supports sort, filter, deduplicate, clean, normalize, aggregate and generic exact join. Source sheets are inspected into tables; transformation output is written to a separate result sheet unless the worker can preserve safely.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        sheetName: nullableText(120),
        operation: { type: 'string', enum: ['sort','filter','deduplicate','clean','normalize','aggregate','join'] },
        keyColumns: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 160 } },
        column: nullableText(160),
        direction: { type: ['string','null'], enum: ['asc','desc',null] },
        equalsValue: { type: ['string','number','boolean','null'], maxLength: 500 },
        groupByColumns: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 160 } },
        valueColumn: nullableText(160),
        aggregation: { type: ['string','null'], enum: ['count','sum','average','min','max',null] },
        secondaryAttachmentId: nullableText(200),
        secondarySheetName: nullableText(120),
        secondaryKeyColumn: nullableText(160),
        copyColumns: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 160 } },
        outputSheetName: nullableText(120),
        outputFileName: nullableText(180),
      },
      required: ['attachmentId','sheetName','operation','keyColumns','column','direction','equalsValue','groupByColumns','valueColumn','aggregation','secondaryAttachmentId','secondarySheetName','secondaryKeyColumn','copyColumns','outputSheetName','outputFileName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'create_spreadsheet_file',
    description: 'Create a new XLSX workbook from structured rows and return it as a JetWork file artifact. Use when the user asks for a new spreadsheet rather than modifying an existing one.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fileName: nullableText(180),
        sheetName: { type: 'string', minLength: 1, maxLength: 120 },
        headers: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'string', maxLength: 240 } },
        rows: {
          type: 'array', maxItems: 2_000,
          items: { type: 'array', maxItems: 80, items: { type: ['string','number','boolean','null'], maxLength: 4_000 } },
        },
      },
      required: ['fileName','sheetName','headers','rows'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'validate_spreadsheet_file',
    description: 'Reload and validate an XLSX attachment or generated output for workbook integrity, sheet structure, dimensions and basic schema anomalies. Use as a QA step for important spreadsheet deliverables.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        sheetName: nullableText(120),
      },
      required: ['attachmentId','sheetName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'sync_spreadsheet_with_jira_export',
    description: 'Update a target XLSX from an attached Jira-export XLSX using explicit column mappings. For Jira sync tasks this is the required completion tool after list/inspect. Do not stop after inspection. If the target has no suitable status column, use Durum. Preserves structure/styles where possible, validates the output, and returns a JetWork XLSX file artifact.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        targetAttachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        jiraAttachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        targetSheetName: nullableText(120),
        jiraSheetName: nullableText(120),
        targetKeyColumn: { type: 'string', minLength: 1, maxLength: 160 },
        jiraKeyColumn: { type: 'string', minLength: 1, maxLength: 160 },
        jiraStatusColumn: { type: 'string', minLength: 1, maxLength: 160 },
        targetStatusColumn: { type: 'string', minLength: 1, maxLength: 160 },
        doneStatuses: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 80 } },
        completedValue: { type: 'string', minLength: 1, maxLength: 160 },
        jiraSprintColumn: { type: 'string', minLength: 1, maxLength: 160 },
        targetSprintColumn: { type: 'string', minLength: 1, maxLength: 160 },
        sprintNamePattern: nullableText(120),
        outputFileName: nullableText(180),
      },
      required: ['targetAttachmentId','jiraAttachmentId','targetSheetName','jiraSheetName','targetKeyColumn','jiraKeyColumn','jiraStatusColumn','targetStatusColumn','doneStatuses','completedValue','jiraSprintColumn','targetSprintColumn','sprintNamePattern','outputFileName'],
      additionalProperties: false,
    },
  },
] as const

const EXECUTION_TOOL_NAMES = new Set(ASSISTANT_EXECUTION_TOOLS.map(tool => tool.name))
export const isExecutionTool = (toolName: string) => EXECUTION_TOOL_NAMES.has(toolName as never)

export async function executeExecutionTool(input: {
  toolName: string
  args: Record<string, unknown>
  workspaceId: string
  attachments: AssistantExecutionAttachmentRef[]
  invoke: (request: SpreadsheetExecutionRequest) => Promise<Record<string, unknown>>
}): Promise<ExecutionToolResult> {
  if (input.toolName === 'list_spreadsheet_attachments') {
    const records = input.attachments.map((attachment, index) => ({ position: index + 1, attachmentId: attachment.attachmentId, name: attachment.name, mimeType: attachment.mimeType }))
    return { output: JSON.stringify({ securityNotice: EXECUTION_NOTICE, tool: input.toolName, records }), artifacts: [], summary: { executionOnly: true, citationReady: false, operation: 'list', resultCount: records.length } }
  }

  if (input.toolName === 'inspect_spreadsheet_file') {
    const attachment = requireAttachment(input.args.attachmentId, input.attachments)
    const result = await input.invoke({ operation: 'inspect', workspaceId: input.workspaceId, input: attachment, sheetName: input.args.sheetName === null ? null : clean(input.args.sheetName, 120) })
    return { output: JSON.stringify({ securityNotice: EXECUTION_NOTICE, tool: input.toolName, result }), artifacts: [], summary: { executionOnly: true, citationReady: false, operation: 'inspect', attachmentId: attachment.attachmentId } }
  }

  if (input.toolName === 'edit_spreadsheet_file') {
    const attachment = requireAttachment(input.args.attachmentId, input.attachments)
    const actions = Array.isArray(input.args.actions) ? input.args.actions.slice(0, 50) : []
    if (!actions.length) throw new Error('At least one spreadsheet edit action is required.')
    const result = await input.invoke({
      operation: 'edit', workspaceId: input.workspaceId, input: attachment,
      sheetName: input.args.sheetName === null ? null : clean(input.args.sheetName, 120),
      config: { actions, outputFileName: input.args.outputFileName === null ? null : clean(input.args.outputFileName, 180) },
    })
    return artifactResult(input.toolName, 'edit', result, { attachmentId: attachment.attachmentId })
  }

  if (input.toolName === 'transform_spreadsheet_file') {
    const attachment = requireAttachment(input.args.attachmentId, input.attachments)
    const secondaryId = clean(input.args.secondaryAttachmentId, 200)
    const secondary = secondaryId ? requireAttachment(secondaryId, input.attachments) : undefined
    const result = await input.invoke({
      operation: 'transform', workspaceId: input.workspaceId, input: attachment, secondaryInput: secondary,
      sheetName: input.args.sheetName === null ? null : clean(input.args.sheetName, 120),
      secondarySheetName: input.args.secondarySheetName === null ? null : clean(input.args.secondarySheetName, 120),
      config: {
        operation: clean(input.args.operation, 40),
        keyColumns: Array.isArray(input.args.keyColumns) ? input.args.keyColumns.map(value => clean(value, 160)).filter(Boolean).slice(0, 8) : [],
        column: input.args.column === null ? null : clean(input.args.column, 160),
        direction: input.args.direction === null ? null : clean(input.args.direction, 10),
        equalsValue: input.args.equalsValue ?? null,
        groupByColumns: Array.isArray(input.args.groupByColumns) ? input.args.groupByColumns.map(value => clean(value, 160)).filter(Boolean).slice(0, 8) : [],
        valueColumn: input.args.valueColumn === null ? null : clean(input.args.valueColumn, 160),
        aggregation: input.args.aggregation === null ? null : clean(input.args.aggregation, 20),
        secondaryKeyColumn: input.args.secondaryKeyColumn === null ? null : clean(input.args.secondaryKeyColumn, 160),
        copyColumns: Array.isArray(input.args.copyColumns) ? input.args.copyColumns.map(value => clean(value, 160)).filter(Boolean).slice(0, 20) : [],
        outputSheetName: input.args.outputSheetName === null ? null : clean(input.args.outputSheetName, 120),
        outputFileName: input.args.outputFileName === null ? null : clean(input.args.outputFileName, 180),
      },
    })
    return artifactResult(input.toolName, 'transform', result, { attachmentId: attachment.attachmentId, secondaryAttachmentId: secondary?.attachmentId || null })
  }

  if (input.toolName === 'create_spreadsheet_file') {
    const result = await input.invoke({
      operation: 'create', workspaceId: input.workspaceId,
      config: {
        fileName: input.args.fileName === null ? null : clean(input.args.fileName, 180),
        sheetName: clean(input.args.sheetName, 120),
        headers: Array.isArray(input.args.headers) ? input.args.headers.map(value => clean(value, 240)).slice(0, 80) : [],
        rows: Array.isArray(input.args.rows) ? input.args.rows.slice(0, 2_000) : [],
      },
    })
    return artifactResult(input.toolName, 'create', result)
  }

  if (input.toolName === 'validate_spreadsheet_file') {
    const attachment = requireAttachment(input.args.attachmentId, input.attachments)
    const result = await input.invoke({ operation: 'validate', workspaceId: input.workspaceId, input: attachment, sheetName: input.args.sheetName === null ? null : clean(input.args.sheetName, 120) })
    return { output: JSON.stringify({ securityNotice: EXECUTION_NOTICE, tool: input.toolName, result }), artifacts: [], summary: { executionOnly: true, citationReady: false, operation: 'validate', attachmentId: attachment.attachmentId, ...(result.summary && typeof result.summary === 'object' ? result.summary as Record<string, unknown> : {}) } }
  }

  if (input.toolName === 'sync_spreadsheet_with_jira_export') {
    const target = requireAttachment(input.args.targetAttachmentId, input.attachments)
    const jira = requireAttachment(input.args.jiraAttachmentId, input.attachments)
    const result = await input.invoke({
      operation: 'jira_sync', workspaceId: input.workspaceId, input: target, jiraInput: jira,
      sheetName: input.args.targetSheetName === null ? null : clean(input.args.targetSheetName, 120),
      jiraSheetName: input.args.jiraSheetName === null ? null : clean(input.args.jiraSheetName, 120),
      config: {
        targetKeyColumn: clean(input.args.targetKeyColumn, 160), jiraKeyColumn: clean(input.args.jiraKeyColumn, 160), jiraStatusColumn: clean(input.args.jiraStatusColumn, 160), targetStatusColumn: clean(input.args.targetStatusColumn, 160),
        doneStatuses: Array.isArray(input.args.doneStatuses) ? input.args.doneStatuses.map(value => clean(value, 80)).filter(Boolean).slice(0, 12) : [],
        completedValue: clean(input.args.completedValue, 160), jiraSprintColumn: clean(input.args.jiraSprintColumn, 160), targetSprintColumn: clean(input.args.targetSprintColumn, 160),
        sprintNamePattern: input.args.sprintNamePattern === null ? null : clean(input.args.sprintNamePattern, 120), outputFileName: input.args.outputFileName === null ? null : clean(input.args.outputFileName, 180),
      },
    })
    return artifactResult(input.toolName, 'jira_sync', result, { targetAttachmentId: target.attachmentId, jiraAttachmentId: jira.attachmentId })
  }

  throw new Error(`Unknown execution tool: ${input.toolName}`)
}
