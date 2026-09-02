import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AGENT_CONTROLLER_V2_FLAG,
  LEGACY_AGENT_CONTROLLER_FLAG,
  isAgentControllerV2Enabled,
  isLegacyAgentControllerEnabled,
} from '../../../supabase/functions/_shared/runtime/runtimeFlags.ts'
import { buildAuthoritativeInventoryFastPlan } from '../../../supabase/functions/_shared/authoritativeInventoryFastPath.ts'
import { shouldUseTrivialAssistantFastPath } from '../../../supabase/functions/_shared/trivialAssistantFastPath.ts'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator.ts'
import {
  ASSISTANT_ARTIFACT_TOOLS,
  executeArtifactExecutionTool,
} from '../../../supabase/functions/_shared/artifactExecutionTools.ts'

const durableCoreEntrySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/index.ts', import.meta.url),
  'utf8',
)

describe('Agent Controller V2 runtime boundary', () => {
  it('defaults to disabled when rollout configuration is missing', () => {
    expect(isAgentControllerV2Enabled(() => undefined)).toBe(false)
  })

  it('uses only the canonical rollout flag to enable Controller V2', () => {
    const canonical = new Map<string, string>([
      [AGENT_CONTROLLER_V2_FLAG, 'true'],
      [LEGACY_AGENT_CONTROLLER_FLAG, 'false'],
    ])
    expect(isAgentControllerV2Enabled(name => canonical.get(name))).toBe(true)

    const legacyOnly = new Map<string, string>([[LEGACY_AGENT_CONTROLLER_FLAG, 'true']])
    expect(isAgentControllerV2Enabled(name => legacyOnly.get(name))).toBe(false)
    expect(isLegacyAgentControllerEnabled(name => legacyOnly.get(name))).toBe(true)
  })

  it('treats invalid canonical configuration as disabled', () => {
    const values = new Map<string, string>([
      [AGENT_CONTROLLER_V2_FLAG, 'maybe'],
      [LEGACY_AGENT_CONTROLLER_FLAG, 'true'],
    ])
    expect(isAgentControllerV2Enabled(name => values.get(name))).toBe(false)
  })

  it('bridges the canonical rollout decision into the durable core before implementation loads', () => {
    expect(durableCoreEntrySource).toContain("Deno.env.set('ASSISTANT_AGENTIC_CONTROLLER', isAgentControllerV2Enabled() ? 'true' : 'false')")
    expect(durableCoreEntrySource.indexOf("Deno.env.set('ASSISTANT_AGENTIC_CONTROLLER'"))
      .toBeLessThan(durableCoreEntrySource.indexOf("await import('./implementation.ts')"))
  })

  it('makes semantic preplanning advisory instead of choosing capabilities', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      message: 'SAP CRM ZCRM2-545 hatasını araştır ve gerekiyorsa webden de doğrula',
      conversation: [],
      agentControllerV2Enabled: true,
    })

    expect(result.plan.intent).toBe('analysis')
    expect(result.plan.executionMode).toBe('direct')
    expect(result.plan.knowledgeRequired).toBe(false)
    expect(result.plan.webMode).toBe('none')
    expect(result.plan.evidenceQueries).toEqual([])
    expect(result.plan.enterpriseGroundingRequired).toBe(true)
    expect(result.usage?.controller_v2_advisory_plan).toBe(1)
  })

  it('exposes the canonical Enerjisa document contract as a controller-selected artifact capability', async () => {
    expect(ASSISTANT_ARTIFACT_TOOLS.some(tool => tool.name === 'load_document_contract')).toBe(true)
    const result = await executeArtifactExecutionTool({
      toolName: 'load_document_contract',
      args: { contractKey: 'enerjisa-analysis-docx' },
      workspaceId: 'test-workspace',
      attachments: [],
      invoke: async () => { throw new Error('contract loading must not invoke binary execution') },
    })

    expect(result.artifacts).toEqual([])
    expect(result.summary).toMatchObject({
      proceduralOnly: true,
      controllerDecisionRequired: true,
      contractKey: 'enerjisa-analysis-docx',
    })
    expect(result.output).toContain('JETWORK_RUNTIME_DOCUMENT_PROFILE:ENERJISA_ANALYSIS_DOCX')
    expect(result.output).toContain('create_document_file')
  })

  it('does not allow the authoritative inventory fast path to bypass an active controller', () => {
    expect(buildAuthoritativeInventoryFastPlan('hangi classlar var', {
      agentControllerV2Enabled: true,
    })).toBeNull()
  })

  it('does not allow the trivial fast path to bypass an active controller', () => {
    expect(shouldUseTrivialAssistantFastPath({
      message: 'merhaba',
      model: 'auto',
      attachmentCount: 0,
      agentControllerV2Enabled: true,
    })).toBe(false)
  })

  it('keeps legacy fast paths available only while Controller V2 is disabled', () => {
    const plan = buildAuthoritativeInventoryFastPlan('hangi classlar var', {
      agentControllerV2Enabled: false,
    })
    expect(plan?.enumerationTarget?.tool).toBe('list_class_inventory')
    expect(shouldUseTrivialAssistantFastPath({
      message: 'merhaba',
      model: 'auto',
      attachmentCount: 0,
      agentControllerV2Enabled: false,
    })).toBe(true)
  })
})
