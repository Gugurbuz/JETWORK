import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AGENT_CONTROLLER_V2_FLAG,
  DENO_DEPLOYMENT_ID_ENV,
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
const publicEntryRouterSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-entry-router/index.ts', import.meta.url),
  'utf8',
)
const reasoningEngineSource = readFileSync(
  new URL('../../../supabase/functions/_shared/reasoningEngine.ts', import.meta.url),
  'utf8',
)

describe('Agent Controller V2 runtime boundary', () => {
  it('defaults to disabled when rollout configuration is missing', () => {
    expect(isAgentControllerV2Enabled(() => undefined)).toBe(false)
  })

  it('uses the canonical rollout flag in normal deployments and ignores the legacy flag', () => {
    const canonical = new Map<string, string>([
      [AGENT_CONTROLLER_V2_FLAG, 'true'],
      [LEGACY_AGENT_CONTROLLER_FLAG, 'false'],
    ])
    expect(isAgentControllerV2Enabled(name => canonical.get(name))).toBe(true)

    const legacyOnly = new Map<string, string>([[LEGACY_AGENT_CONTROLLER_FLAG, 'true']])
    expect(isAgentControllerV2Enabled(name => legacyOnly.get(name))).toBe(false)
    expect(isLegacyAgentControllerEnabled(name => legacyOnly.get(name))).toBe(true)
  })

  it('allows only explicit non-production canary function identities to enable live-like V2', () => {
    const goldenCanary = new Map<string, string>([[
      DENO_DEPLOYMENT_ID_ENV,
      'bpbbvjigostgrssnduhk_8889f9e7-b72b-4549-b793-0045311043d6_12',
    ]])
    const coreCanary = new Map<string, string>([[
      DENO_DEPLOYMENT_ID_ENV,
      'bpbbvjigostgrssnduhk_7806a5b9-17a7-4cae-a15e-c3e2d6ec8eac_4',
    ]])
    expect(isAgentControllerV2Enabled(name => goldenCanary.get(name))).toBe(true)
    expect(isAgentControllerV2Enabled(name => coreCanary.get(name))).toBe(true)

    const productionGateway = new Map<string, string>([[
      DENO_DEPLOYMENT_ID_ENV,
      'bpbbvjigostgrssnduhk_0f38ecb0-e3c9-4adb-8aec-a52c3474d266_101',
    ]])
    expect(isAgentControllerV2Enabled(name => productionGateway.get(name))).toBe(false)
  })

  it('treats invalid canonical configuration as disabled outside explicit canary deployments', () => {
    const values = new Map<string, string>([
      [AGENT_CONTROLLER_V2_FLAG, 'maybe'],
      [LEGACY_AGENT_CONTROLLER_FLAG, 'true'],
      [DENO_DEPLOYMENT_ID_ENV, 'bpbbvjigostgrssnduhk_0f38ecb0-e3c9-4adb-8aec-a52c3474d266_101'],
    ])
    expect(isAgentControllerV2Enabled(name => values.get(name))).toBe(false)
  })

  it('bridges the canonical/canary rollout decision into the durable core before implementation loads', () => {
    expect(durableCoreEntrySource).toContain("Deno.env.set('ASSISTANT_AGENTIC_CONTROLLER', isAgentControllerV2Enabled() ? 'true' : 'false')")
    expect(durableCoreEntrySource.indexOf("Deno.env.set('ASSISTANT_AGENTIC_CONTROLLER'"))
      .toBeLessThan(durableCoreEntrySource.indexOf("await import('./implementation.ts')"))
  })

  it('bypasses legacy semantic entry routing before any regex classifier runs', () => {
    expect(publicEntryRouterSource).toContain('if (isAgentControllerV2Enabled())')
    expect(publicEntryRouterSource).toContain("headers.set('x-jetwork-runtime-route', 'agent-controller-v2')")
    expect(publicEntryRouterSource).toContain("/functions/v1/openai-assistant-v2-internal")
    expect(publicEntryRouterSource.indexOf('if (isAgentControllerV2Enabled())'))
      .toBeLessThan(publicEntryRouterSource.indexOf('const routeDecision = classifyDocumentArtifactRequest(message)'))
    expect(publicEntryRouterSource.indexOf('if (isAgentControllerV2Enabled())'))
      .toBeLessThan(publicEntryRouterSource.indexOf('const longContextNeedsReasoning = message.length >= 2_000'))
  })

  it('keeps the core semantically neutral even if a V2 gateway is accidentally bypassed', () => {
    expect(reasoningEngineSource).toContain('if (isAgentControllerV2Enabled()) return controllerV2NeutralRoute()')
    expect(reasoningEngineSource).toContain('controller_v2_core_neutral_fallback: 1')
    expect(reasoningEngineSource).toContain("orchestratorVersion: 'agent-controller-v2-core-neutral-fallback'")
    expect(reasoningEngineSource.indexOf('if (isAgentControllerV2Enabled()) return controllerV2NeutralRoute()'))
      .toBeLessThan(reasoningEngineSource.indexOf('return routeLegacyReasoningRequest(message, attachmentCount)'))
    expect(reasoningEngineSource.indexOf('if (isAgentControllerV2Enabled()) {\n    return {\n      plan: controllerV2NeutralPlan(input.message)'))
      .toBeLessThan(reasoningEngineSource.indexOf('const legacy = await buildLegacyReasoningPlan(input)'))
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
