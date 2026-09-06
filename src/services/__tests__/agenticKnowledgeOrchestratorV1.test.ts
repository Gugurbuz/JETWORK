import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const assistantRuntime = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsAgenticRuntime.ts', import.meta.url),
  'utf8',
)
const assistantRuntimeV5 = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsAgenticRuntimeV5.ts', import.meta.url),
  'utf8',
)
const modelProviderV5 = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersAgenticRuntimeV5.ts', import.meta.url),
  'utf8',
)
const xlsxCreateRuntime = readFileSync(
  new URL('../../../supabase/functions/agentic-spreadsheet-create/index.ts', import.meta.url),
  'utf8',
)
const controllerSurface = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurfaceAgenticRuntime.ts', import.meta.url),
  'utf8',
)
const controllerSurfaceV3 = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurfaceAgenticRuntimeV3.ts', import.meta.url),
  'utf8',
)
const controllerPolicy = readFileSync(
  new URL('../../../supabase/functions/_shared/agentControllerPolicyAgenticRuntime.ts', import.meta.url),
  'utf8',
)

describe('Agentic Knowledge Orchestrator v1', () => {
  it('exposes one high-level knowledge capability while keeping legacy executors behind runtime', () => {
    expect(assistantRuntime).toContain("HIGH_LEVEL_KNOWLEDGE_TOOL_NAME = 'research_knowledge'")
    expect(assistantRuntime).toContain('canonical resolution, semantic candidate retrieval, exact verification')
    expect(assistantRuntime).toContain("baseExecuteAssistantTool(client, workspaceId, 'get_knowledge_object'")
    expect(assistantRuntime).toContain("baseExecuteAssistantTool(client, workspaceId, 'search_knowledge_catalog'")
    expect(assistantRuntime).toContain("baseExecuteAssistantTool(client, workspaceId, 'get_related_objects'")
    expect(assistantRuntime).toContain('sharedEvidenceBundle: true')
  })

  it('collapses retrieval micro-tools from the controller-facing surface', () => {
    expect(controllerSurface).toContain('LEGACY_KNOWLEDGE_TOOLS')
    expect(controllerSurface).toContain('surface.tools.filter(tool => !LEGACY_KNOWLEDGE_TOOLS.has(tool.name))')
    expect(controllerSurface).toContain('HIGH_LEVEL_KNOWLEDGE_TOOL')
    expect(controllerSurface).toContain('Do not manage search/list/get/relation micro-protocols yourself')
  })

  it('keeps explicit comparison identifiers in one shared research call', () => {
    expect(controllerSurfaceV3).toContain('Preserve every explicit technical identifier')
    expect(controllerSurfaceV3).toContain('ONE research_knowledge call')
    expect(controllerSurfaceV3).toContain('do not replace them with a generic discovery request first')
  })

  it('supports one execution for DOCX and XLSX generated from the same analysis state', () => {
    expect(assistantRuntime).toContain("ARTIFACT_BUNDLE_TOOL_NAME = 'create_artifact_bundle'")
    expect(assistantRuntime).toContain("baseExecuteAssistantTool(client, workspaceId, 'create_document_file'")
    expect(assistantRuntime).toContain("baseExecuteAssistantTool(client, workspaceId, 'create_spreadsheet_file'")
    expect(assistantRuntime).toContain('sharedAnalysisState: true')
    expect(assistantRuntime).toContain('allOutputsVerified')
    expect(controllerSurface).toContain('ARTIFACT_BUNDLE_TOOL')
  })

  it('fails closed when artifact enterprise identifiers are not present in shared verified evidence', () => {
    expect(assistantRuntimeV5).toContain('ARTIFACT_GROUNDING_EVIDENCE_MISSING')
    expect(assistantRuntimeV5).toContain('ARTIFACT_GROUNDING_VALIDATION_FAILED')
    expect(assistantRuntimeV5).toContain('Unsupported enterprise identifiers')
    expect(assistantRuntimeV5).toContain('evidenceByWorkspace.set')
    expect(assistantRuntimeV5).toContain('mechanicalCoverageComplete === true')
    expect(assistantRuntimeV5).toContain("ASCII tail of Turkish words")
  })

  it('uses a stronger controller after verified knowledge without reopening completed research', () => {
    expect(modelProviderV5).toContain("KNOWLEDGE_TOOL_NAME = 'research_knowledge'")
    expect(modelProviderV5).toContain('MAX_BLANK_CONTINUATION_RECOVERY_ATTEMPTS = 2')
    expect(modelProviderV5).toContain('withoutCompletedKnowledgeTool')
    expect(modelProviderV5).toContain('research_knowledge is intentionally unavailable because that dependency is complete')
    expect(modelProviderV5).toContain('controller_verified_knowledge_continuation_to_pro')
    expect(modelProviderV5).toContain('controller_completed_knowledge_tool_hidden')
    expect(modelProviderV5).toContain('closed factual vocabulary')
  })

  it('uses the dedicated XLSX creator and requires verified outputs before artifact completion', () => {
    expect(assistantRuntimeV5).toContain("client.functions.invoke('agentic-spreadsheet-create'")
    expect(assistantRuntimeV5).toContain("qa.reloaded !== true || qa.workbookReadable !== true")
    expect(assistantRuntimeV5).toContain('artifactVerification: { reloadVerified: true, integrityVerified: true')
    expect(assistantRuntimeV5).toContain("throw new Error('ARTIFACT_BUNDLE_VERIFICATION_FAILED')")
    expect(assistantRuntimeV5).toContain("ARTIFACT_COMPLETION_MARKER = 'JETWORK_ARTIFACT_DEPENDENCY_COMPLETE'")
    expect(assistantRuntimeV5).toContain('artifactGroundingVerified: true')
  })

  it('keeps the create-only XLSX executor self-contained, authenticated and reload-verified', () => {
    expect(xlsxCreateRuntime).toContain("from 'npm:@office-kit/xlsx@0.9.0/io'")
    expect(xlsxCreateRuntime).toContain('client.auth.getUser()')
    expect(xlsxCreateRuntime).toContain(".from('workspaces')")
    expect(xlsxCreateRuntime).toContain('loadWorkbook(fromArrayBuffer(bytes))')
    expect(xlsxCreateRuntime).toContain('workbookReadable: true')
    expect(xlsxCreateRuntime).toContain("storageBucket: ASSISTANT_FILES_BUCKET")
    expect(xlsxCreateRuntime).not.toContain('raw.githubusercontent.com/Gugurbuz/JETWORK')
  })

  it('keeps semantic decisions with the controller and retrieval mechanics in runtime', () => {
    expect(controllerPolicy).toContain('Karar sahibi hâlâ sensin')
    expect(controllerPolicy).toContain('research_knowledge')
    expect(controllerPolicy).toContain('aynı analysis stateinden istenen artifactlar')
    expect(controllerPolicy).toContain('Artifact toolu kurumsal factual evidence üretmez')
    expect(controllerPolicy).not.toContain('CHECK_FATURADAR')
  })
})
