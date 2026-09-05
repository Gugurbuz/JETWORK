import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const assistantRuntime = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsAgenticRuntime.ts', import.meta.url),
  'utf8',
)
const controllerSurface = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurfaceAgenticRuntime.ts', import.meta.url),
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

  it('supports one execution for DOCX and XLSX generated from the same analysis state', () => {
    expect(assistantRuntime).toContain("ARTIFACT_BUNDLE_TOOL_NAME = 'create_artifact_bundle'")
    expect(assistantRuntime).toContain("baseExecuteAssistantTool(client, workspaceId, 'create_document_file'")
    expect(assistantRuntime).toContain("baseExecuteAssistantTool(client, workspaceId, 'create_spreadsheet_file'")
    expect(assistantRuntime).toContain('sharedAnalysisState: true')
    expect(assistantRuntime).toContain('allOutputsVerified')
    expect(controllerSurface).toContain('ARTIFACT_BUNDLE_TOOL')
  })

  it('keeps semantic decisions with the controller and retrieval mechanics in runtime', () => {
    expect(controllerPolicy).toContain('Karar sahibi hâlâ sensin')
    expect(controllerPolicy).toContain('research_knowledge')
    expect(controllerPolicy).toContain('aynı analysis stateinden istenen artifactlar')
    expect(controllerPolicy).toContain('Artifact toolu kurumsal factual evidence üretmez')
    expect(controllerPolicy).not.toContain('CHECK_FATURADAR')
  })
})
