import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  ARTIFACT_BUNDLE_TOOL,
  ARTIFACT_BUNDLE_TOOL_NAME,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL_NAME,
  executeAssistantTool as executeAgenticRuntimeV4,
  type AssistantSourceRef,
  type AssistantToolExecution,
} from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@7777e9abca289639090a8f5ab0722de33cf3fbcc/supabase/functions/_shared/assistantToolsAgenticRuntimeV4.ts?knowledge-runtime-v5-base=1'

export {
  ASSISTANT_KNOWLEDGE_TOOLS,
  ARTIFACT_BUNDLE_TOOL,
  ARTIFACT_BUNDLE_TOOL_NAME,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL_NAME,
}
export type { AssistantSourceRef, AssistantToolExecution }

export const KNOWLEDGE_RUNTIME_VERSION = 'knowledge-runtime-v5'
const ARTIFACT_COMPLETION_MARKER = 'JETWORK_ARTIFACT_DEPENDENCY_COMPLETE'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const evidenceByWorkspace = new Map<string, { at: number; output: string }>()
const EVIDENCE_TTL_MS = 10 * 60 * 1000

const clean = (value: unknown, max = 400_000) => String(value ?? '').trim().slice(0, max)
const parseJson = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}
const prune = () => {
  const now = Date.now()
  for (const [key, value] of evidenceByWorkspace) if (now - value.at > EVIDENCE_TTL_MS) evidenceByWorkspace.delete(key)
}

const enterpriseIdentifiers = (value: string) => {
  const found = new Set<string>()
  // ABAP/customer identifiers that start with Z normally contain an underscore or digit.
  // Requiring that signal prevents Unicode word-boundary false positives such as the
  // ASCII tail of Turkish words (e.g. ÖZELLİKLER -> ZELLIKLER, ÜZERİNDE -> ZERINDE).
  for (const match of value.matchAll(/\bZ(?=[A-Z0-9_]*[_0-9])[A-Z0-9_]{2,}(?:-\d{2,5})?\b/g)) found.add(match[0])
  for (const match of value.matchAll(/\b[A-Z][A-Z0-9_]{2,}-\d{2,6}\b/g)) found.add(match[0])
  return [...found]
}

const artifactText = (args: Record<string, unknown>) => {
  const document = args.document && typeof args.document === 'object' && !Array.isArray(args.document)
    ? args.document as Record<string, unknown> : null
  const spreadsheet = args.spreadsheet && typeof args.spreadsheet === 'object' && !Array.isArray(args.spreadsheet)
    ? args.spreadsheet as Record<string, unknown> : null
  const rows = spreadsheet && Array.isArray(spreadsheet.rows) ? spreadsheet.rows : []
  const metadata = document && Array.isArray(document.metadata) ? document.metadata : []
  return [
    clean(document?.title, 2_000),
    clean(document?.markdown, 400_000),
    JSON.stringify(metadata),
    JSON.stringify(rows),
  ].join('\n')
}

const validateArtifactGrounding = (workspaceId: string, args: Record<string, unknown>) => {
  const cached = evidenceByWorkspace.get(workspaceId)
  if (!cached) throw new Error('ARTIFACT_GROUNDING_EVIDENCE_MISSING: Run verified enterprise research before artifact creation.')
  const evidenceUpper = cached.output.toLocaleUpperCase('en-US')
  const identifiers = enterpriseIdentifiers(artifactText(args).toLocaleUpperCase('en-US'))
  const unsupported = identifiers.filter(identifier => !evidenceUpper.includes(identifier))
  if (unsupported.length) {
    throw new Error(`ARTIFACT_GROUNDING_VALIDATION_FAILED: Unsupported enterprise identifiers: ${unsupported.join(', ')}. Regenerate the artifact using only identifiers and facts present in the verified shared evidence bundle.`)
  }
  return { identifiersChecked: identifiers.length, unsupportedIdentifiers: unsupported }
}

const asArtifactRef = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const storagePath = clean(row.storagePath, 1_000)
  if (!storagePath) return null
  return {
    attachmentId: clean(row.attachmentId, 200),
    name: clean(row.name, 240),
    mimeType: clean(row.mimeType || XLSX_MIME, 160),
    storageBucket: clean(row.storageBucket || 'assistant-files', 120),
    storagePath,
  }
}

async function createSpreadsheet(
  client: any,
  workspaceId: string,
  spreadsheet: Record<string, unknown>,
): Promise<AssistantToolExecution> {
  const { data, error } = await client.functions.invoke('agentic-spreadsheet-create', {
    body: {
      workspaceId,
      fileName: spreadsheet.fileName ?? null,
      sheetName: clean(spreadsheet.sheetName, 120) || 'Bulgular',
      headers: Array.isArray(spreadsheet.headers) ? spreadsheet.headers.slice(0, 80) : [],
      rows: Array.isArray(spreadsheet.rows) ? spreadsheet.rows.slice(0, 2_000) : [],
    },
  })
  if (error) {
    let detail = ''
    try {
      const context = (error as any)?.context
      const payload = context && typeof context.json === 'function' ? await context.json() : null
      detail = clean(payload?.error || payload?.message, 2_000)
    } catch { /* best effort */ }
    throw new Error(detail || clean((error as any)?.message, 2_000) || 'agentic-spreadsheet-create failed.')
  }
  if (!data || typeof data !== 'object') throw new Error('agentic-spreadsheet-create returned invalid payload.')
  const payload = data as Record<string, unknown>
  if (payload.error) throw new Error(clean(payload.error, 2_000))
  const artifact = asArtifactRef(payload.artifact)
  if (!artifact) throw new Error('agentic-spreadsheet-create returned no artifact.')
  const summary = payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
    ? payload.summary as Record<string, unknown> : {}
  const qa = summary.qa && typeof summary.qa === 'object' && !Array.isArray(summary.qa)
    ? summary.qa as Record<string, unknown> : {}
  if (qa.reloaded !== true || qa.workbookReadable !== true) throw new Error('XLSX_ARTIFACT_QA_FAILED')
  return {
    output: JSON.stringify({ securityNotice: 'JETWORK_EXECUTION_RESULT.', tool: 'agentic-spreadsheet-create', result: { artifact: { attachmentId: artifact.attachmentId, name: artifact.name, mimeType: artifact.mimeType }, summary } }),
    sources: [],
    artifacts: [artifact],
    summary: {
      executionOnly: true,
      citationReady: false,
      operation: 'create',
      artifactCount: 1,
      ...summary,
      artifactVerification: { reloadVerified: true, integrityVerified: true, artifactCount: 1, engine: 'office-kit-xlsx' },
    },
  }
}

async function cleanupArtifacts(client: any, artifacts: Array<{ storageBucket: string; storagePath: string }>) {
  for (const artifact of artifacts) {
    if (!artifact.storageBucket || !artifact.storagePath) continue
    await client.storage.from(artifact.storageBucket).remove([artifact.storagePath]).catch(() => undefined)
  }
}

async function createArtifactBundleV5(
  client: any,
  workspaceId: string,
  args: Record<string, unknown>,
): Promise<AssistantToolExecution> {
  const grounding = validateArtifactGrounding(workspaceId, args)
  const document = args.document && typeof args.document === 'object' && !Array.isArray(args.document)
    ? args.document as Record<string, unknown> : null
  const spreadsheet = args.spreadsheet && typeof args.spreadsheet === 'object' && !Array.isArray(args.spreadsheet)
    ? args.spreadsheet as Record<string, unknown> : null
  if (!document && !spreadsheet) throw new Error('create_artifact_bundle requires document and/or spreadsheet output.')

  const executions: Array<{ format: 'docx' | 'xlsx'; result: AssistantToolExecution }> = []
  try {
    if (spreadsheet) executions.push({ format: 'xlsx', result: await createSpreadsheet(client, workspaceId, spreadsheet) })
    if (document) {
      const result = await executeAgenticRuntimeV4(client, workspaceId, 'create_document_file', {
        format: 'docx',
        fileName: document.fileName ?? null,
        title: document.title ?? null,
        markdown: clean(document.markdown, 400_000),
        headerText: document.headerText ?? null,
        footerText: document.footerText ?? null,
        metadata: Array.isArray(document.metadata) ? document.metadata.slice(0, 20) : [],
        paragraphs: [],
        slides: [],
      })
      executions.push({ format: 'docx', result })
    }
  } catch (error) {
    await cleanupArtifacts(client, executions.flatMap(item => item.result.artifacts || []))
    throw error
  }

  const artifacts = executions.flatMap(item => item.result.artifacts || [])
  const allVerified = executions.every(item => {
    const verification = item.result.summary?.artifactVerification
    if (verification && typeof verification === 'object' && !Array.isArray(verification)) {
      const row = verification as Record<string, unknown>
      return row.reloadVerified === true && row.integrityVerified === true
    }
    return false
  })
  if (!allVerified || artifacts.length !== executions.length) {
    await cleanupArtifacts(client, artifacts)
    throw new Error('ARTIFACT_BUNDLE_VERIFICATION_FAILED')
  }

  return {
    output: JSON.stringify({
      securityNotice: 'JETWORK_ARTIFACT_BUNDLE_RESULT. Outputs were created from the controller-provided shared analysis state and verified by their format executors.',
      tool: ARTIFACT_BUNDLE_TOOL_NAME,
      completionMarker: ARTIFACT_COMPLETION_MARKER,
      dependencyState: 'complete',
      grounding,
      outputs: executions.map(item => ({ format: item.format, summary: item.result.summary, result: parseJson(item.result.output) })),
    }),
    sources: [],
    artifacts,
    summary: {
      executionOnly: true,
      artifactBundle: true,
      sharedAnalysisState: true,
      citationReady: false,
      requestedCount: executions.length,
      artifactCount: artifacts.length,
      formats: executions.map(item => item.format),
      allOutputsVerified: true,
      artifactGroundingVerified: true,
      identifiersChecked: grounding.identifiersChecked,
      completionMarker: ARTIFACT_COMPLETION_MARKER,
      dependencyState: 'complete',
    },
  }
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  prune()
  const args = rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
    ? rawArguments as Record<string, unknown> : {}
  if (toolName === HIGH_LEVEL_KNOWLEDGE_TOOL_NAME) {
    const result = await executeAgenticRuntimeV4(client, workspaceId, toolName, args)
    if (result.summary?.mechanicalCoverageComplete === true) evidenceByWorkspace.set(workspaceId, { at: Date.now(), output: result.output })
    return { ...result, summary: { ...result.summary, knowledgeRuntimeVersion: KNOWLEDGE_RUNTIME_VERSION } }
  }
  if (toolName === ARTIFACT_BUNDLE_TOOL_NAME) return createArtifactBundleV5(client, workspaceId, args)
  return executeAgenticRuntimeV4(client, workspaceId, toolName, args)
}
