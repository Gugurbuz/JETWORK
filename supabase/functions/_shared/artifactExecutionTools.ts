import type { AssistantGeneratedFileRef } from './executionTools.ts'
import {
  ENERJISA_ANALYSIS_DOCX_DIRECTIVE,
  ENERJISA_DOCUMENT_CONTRACT_VERSION,
} from './enerjisaDocumentContract.ts'

export interface ActionAttachmentRef {
  attachmentId: string
  name: string
  mimeType: string
  storageBucket: string
  storagePath: string
}

export interface ArtifactExecutionRequest {
  operation: 'inspect' | 'pdf_transform' | 'office_edit' | 'document_create' | 'image_generate_edit'
  workspaceId: string
  input?: ActionAttachmentRef
  inputs?: ActionAttachmentRef[]
  config?: Record<string, unknown>
}

export interface ArtifactExecutionResult {
  output: string
  artifacts: AssistantGeneratedFileRef[]
  summary: Record<string, unknown>
}

const NOTICE = [
  'JETWORK_ARTIFACT_EXECUTION_RESULT.',
  'Bu çıktı dosya/artifact execution katmanının işlem sonucudur; kurumsal bilgi kanıtı veya citation değildir.',
  'Private storage path veya signed URL model cevabına kopyalanmamalıdır; artifact referansı UI dosya kartı ile teslim edilir.',
].join(' ')

const CONTRACT_NOTICE = [
  'TRUSTED_JETWORK_ARTIFACT_CONTRACT.',
  'Bu içerik JetWork ürününün canonical artifact üretim sözleşmesidir; kurumsal factual evidence veya citation değildir.',
  'Controller bu sözleşmeyi artifact biçimi/renderer kuralları için uygular; knowledge/web/skill araştırma kararlarını sözleşmeden türetmez.',
].join(' ')

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)
const nullableText = (maxLength: number) => ({ type: ['string', 'null'], maxLength })

export const ASSISTANT_ARTIFACT_TOOLS = [
  {
    type: 'function',
    name: 'load_document_contract',
    description: 'Load a trusted canonical JetWork document contract after you, the controller LLM, decide that the requested artifact needs that product format. For JetWork business/requirement analysis DOCX, use contractKey=enerjisa-analysis-docx. This tool does not create a file and is not enterprise evidence; after loading it, continue reasoning and call create_document_file only when the document is ready.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        contractKey: { type: 'string', enum: ['enerjisa-analysis-docx'] },
      },
      required: ['contractKey'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_action_attachments',
    description: 'List recent actionable files in the workspace (XLSX, PDF, DOCX, PPTX, images and supported text files). Use before a binary file task when the real attachment id is unknown. If records are returned, never claim the files are missing.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'inspect_file_attachment',
    description: 'Inspect one actionable non-XLSX file. For PDF/images it uses multimodal extraction; for DOCX/PPTX it reads OOXML structure/text. Returns bounded execution context, not enterprise evidence.',
    strict: true,
    parameters: {
      type: 'object', properties: { attachmentId: { type: 'string', minLength: 3, maxLength: 200 } }, required: ['attachmentId'], additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'transform_pdf_file',
    description: 'Create a new PDF artifact by merging attached PDFs or extracting a page range from one PDF. This is a real binary operation and returns a JetWork file card.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['merge', 'split'] },
        attachmentIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 3, maxLength: 200 } },
        startPage: { type: ['integer', 'null'], minimum: 1, maximum: 10_000 },
        endPage: { type: ['integer', 'null'], minimum: 1, maximum: 10_000 },
        outputFileName: nullableText(180),
      },
      required: ['operation','attachmentIds','startPage','endPage','outputFileName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'edit_office_file',
    description: 'Edit an attached DOCX or PPTX using safe OOXML text operations and return a new file artifact. Use replace_text for exact text replacement or append_text to append a new paragraph/slide note-style text block. Inspect first when exact source text is uncertain. Complex layout redesign should use a dedicated generation skill rather than pretending arbitrary OOXML fidelity.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        attachmentId: { type: 'string', minLength: 3, maxLength: 200 },
        operation: { type: 'string', enum: ['replace_text', 'append_text'] },
        findText: nullableText(2_000),
        replacementText: nullableText(8_000),
        outputFileName: nullableText(180),
      },
      required: ['attachmentId','operation','findText','replacementText','outputFileName'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'create_document_file',
    description: 'Create a real DOCX or PPTX artifact. For DOCX, prefer markdown with complete document content: the Python document worker renders headings, paragraphs, bullet/numbered lists, Markdown tables, inline emphasis, header/footer and cover metadata into a styled Word file. paragraphs remains a compatibility fallback when markdown is null. For PPTX use slides. A successful call returns the generated file as a JetWork file card; never claim file completion without this tool result.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['docx', 'pptx'] },
        fileName: nullableText(180),
        title: nullableText(500),
        markdown: nullableText(400_000),
        headerText: nullableText(500),
        footerText: nullableText(500),
        metadata: {
          type: 'array', maxItems: 20,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', maxLength: 200 },
              value: { type: 'string', maxLength: 2_000 },
            },
            required: ['label','value'],
            additionalProperties: false,
          },
        },
        paragraphs: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 8_000 } },
        slides: {
          type: 'array', maxItems: 60,
          items: {
            type: 'object',
            properties: { title: { type: 'string', maxLength: 500 }, body: { type: 'string', maxLength: 8_000 } },
            required: ['title','body'], additionalProperties: false,
          },
        },
      },
      required: ['format','fileName','title','markdown','headerText','footerText','metadata','paragraphs','slides'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'generate_or_edit_image',
    description: 'Generate a new image from a prompt or edit one attached image with Gemini image generation. For edit mode provide attachmentId and describe only the requested change. Returns a PNG/JPEG artifact file card.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['generate', 'edit'] },
        attachmentId: nullableText(200),
        prompt: { type: 'string', minLength: 3, maxLength: 8_000 },
        aspectRatio: { type: ['string', 'null'], enum: ['1:1','3:2','2:3','4:3','3:4','16:9','9:16',null] },
        outputFileName: nullableText(180),
      },
      required: ['mode','attachmentId','prompt','aspectRatio','outputFileName'],
      additionalProperties: false,
    },
  },
] as const

const TOOL_NAMES = new Set(ASSISTANT_ARTIFACT_TOOLS.map(tool => tool.name))
export const isArtifactExecutionTool = (toolName: string) => TOOL_NAMES.has(toolName as never)

const artifactRefs = (result: Record<string, unknown>): AssistantGeneratedFileRef[] => {
  const value = result.artifact
  const artifact = value && typeof value === 'object' ? value as Record<string, unknown> : null
  if (!artifact?.storagePath) return []
  return [{
    attachmentId: clean(artifact.attachmentId || crypto.randomUUID(), 200),
    name: clean(artifact.name || 'jetwork-output', 240),
    mimeType: clean(artifact.mimeType || 'application/octet-stream', 160),
    storageBucket: clean(artifact.storageBucket || 'assistant-files', 120),
    storagePath: clean(artifact.storagePath, 1_000),
  }]
}

const modelSafeResult = (result: Record<string, unknown>) => {
  const { artifact: artifactValue, signedUrl: _signedUrl, storagePath: _storagePath, ...rest } = result
  const artifact = artifactValue && typeof artifactValue === 'object' ? artifactValue as Record<string, unknown> : null
  return {
    ...rest,
    artifact: artifact ? {
      attachmentId: clean(artifact.attachmentId, 200),
      name: clean(artifact.name, 240),
      mimeType: clean(artifact.mimeType, 160),
      byteSize: Number(artifact.byteSize || 0),
      sha256: clean(artifact.sha256, 128),
    } : null,
  }
}

export async function executeArtifactExecutionTool(input: {
  toolName: string
  args: Record<string, unknown>
  workspaceId: string
  attachments: ActionAttachmentRef[]
  invoke: (request: ArtifactExecutionRequest) => Promise<Record<string, unknown>>
}): Promise<ArtifactExecutionResult> {
  if (input.toolName === 'load_document_contract') {
    const contractKey = clean(input.args.contractKey, 120)
    if (contractKey !== 'enerjisa-analysis-docx') throw new Error(`Unknown document contract: ${contractKey || '(empty)'}`)
    return {
      output: JSON.stringify({
        securityNotice: CONTRACT_NOTICE,
        tool: input.toolName,
        contractKey,
        contractVersion: ENERJISA_DOCUMENT_CONTRACT_VERSION,
        directive: ENERJISA_ANALYSIS_DOCX_DIRECTIVE,
      }),
      artifacts: [],
      summary: {
        proceduralOnly: true,
        citationReady: false,
        controllerDecisionRequired: true,
        contractKey,
        contractVersion: ENERJISA_DOCUMENT_CONTRACT_VERSION,
      },
    }
  }
  if (input.toolName === 'list_action_attachments') {
    const records = input.attachments.map((attachment, index) => ({ position: index + 1, attachmentId: attachment.attachmentId, name: attachment.name, mimeType: attachment.mimeType }))
    return { output: JSON.stringify({ securityNotice: NOTICE, tool: input.toolName, records }), artifacts: [], summary: { executionOnly: true, citationReady: false, operation: 'list', resultCount: records.length } }
  }
  const requireRef = (id: unknown) => {
    const key = clean(id, 200)
    const ref = input.attachments.find(candidate => candidate.attachmentId === key)
    if (!ref) throw new Error(`Action attachment not found: ${key || '(empty)'}`)
    return ref
  }
  let request: ArtifactExecutionRequest
  if (input.toolName === 'inspect_file_attachment') {
    request = { operation: 'inspect', workspaceId: input.workspaceId, input: requireRef(input.args.attachmentId) }
  } else if (input.toolName === 'transform_pdf_file') {
    const ids = Array.isArray(input.args.attachmentIds) ? input.args.attachmentIds.map(String).slice(0, 12) : []
    request = { operation: 'pdf_transform', workspaceId: input.workspaceId, inputs: ids.map(requireRef), config: { operation: clean(input.args.operation, 20), startPage: input.args.startPage ?? null, endPage: input.args.endPage ?? null, outputFileName: input.args.outputFileName === null ? null : clean(input.args.outputFileName, 180) } }
  } else if (input.toolName === 'edit_office_file') {
    request = { operation: 'office_edit', workspaceId: input.workspaceId, input: requireRef(input.args.attachmentId), config: { operation: clean(input.args.operation, 30), findText: input.args.findText === null ? null : clean(input.args.findText, 2_000), replacementText: input.args.replacementText === null ? null : String(input.args.replacementText || '').slice(0, 8_000), outputFileName: input.args.outputFileName === null ? null : clean(input.args.outputFileName, 180) } }
  } else if (input.toolName === 'create_document_file') {
    request = {
      operation: 'document_create',
      workspaceId: input.workspaceId,
      config: {
        format: clean(input.args.format, 10),
        fileName: input.args.fileName === null ? null : clean(input.args.fileName, 180),
        title: input.args.title === null ? null : String(input.args.title || '').slice(0, 500),
        markdown: input.args.markdown === null ? null : String(input.args.markdown || '').slice(0, 400_000),
        headerText: input.args.headerText === null ? null : String(input.args.headerText || '').slice(0, 500),
        footerText: input.args.footerText === null ? null : String(input.args.footerText || '').slice(0, 500),
        metadata: Array.isArray(input.args.metadata) ? input.args.metadata.slice(0, 20) : [],
        paragraphs: Array.isArray(input.args.paragraphs) ? input.args.paragraphs.map(value => String(value).slice(0, 8_000)).slice(0, 500) : [],
        slides: Array.isArray(input.args.slides) ? input.args.slides.slice(0, 60) : [],
      },
    }
  } else if (input.toolName === 'generate_or_edit_image') {
    const mode = clean(input.args.mode, 20)
    const ref = mode === 'edit' ? requireRef(input.args.attachmentId) : undefined
    request = { operation: 'image_generate_edit', workspaceId: input.workspaceId, input: ref, config: { mode, prompt: String(input.args.prompt || '').slice(0, 8_000), aspectRatio: input.args.aspectRatio === null ? null : clean(input.args.aspectRatio, 10), outputFileName: input.args.outputFileName === null ? null : clean(input.args.outputFileName, 180) } }
  } else {
    throw new Error(`Unknown artifact execution tool: ${input.toolName}`)
  }
  const result = await input.invoke(request)
  const artifacts = artifactRefs(result)
  return {
    output: JSON.stringify({ securityNotice: NOTICE, tool: input.toolName, result: modelSafeResult(result) }),
    artifacts,
    summary: { executionOnly: true, citationReady: false, tool: input.toolName, artifactCount: artifacts.length, ...(result.summary && typeof result.summary === 'object' ? result.summary as Record<string, unknown> : {}) },
  }
}
