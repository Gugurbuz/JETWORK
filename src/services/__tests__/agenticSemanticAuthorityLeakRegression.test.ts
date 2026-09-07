import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator.ts'

const internalGatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-internal/index.ts', import.meta.url),
  'utf8',
)
const publicGatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url),
  'utf8',
)
const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)
const interactionSource = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiInteractionsRuntimeV3.ts', import.meta.url),
  'utf8',
)
const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const surfaceSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
  'utf8',
)

describe('Agentic semantic authority leak regressions', () => {
  it('materializes the internal gateway locally instead of pinning an old remote runtime', () => {
    expect(internalGatewaySource).toContain("import '../openai-assistant-v2/index.ts'")
    expect(internalGatewaySource).not.toContain('raw.githubusercontent.com')
    expect(internalGatewaySource).not.toMatch(/[0-9a-f]{40}\/supabase\/functions\/openai-assistant-v2/)
  })

  it('keeps the gateway semantic envelope neutral before entering core', () => {
    const attachedPlan = 'message: attachSemanticPlan(currentMessage, semantic.plan)'
    const upstreamFetch = "upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-core-v2`"
    expect(publicGatewaySource).toContain('buildSemanticExecutionPlan({')
    expect(publicGatewaySource).toContain(attachedPlan)
    expect(publicGatewaySource).toContain(upstreamFetch)
    expect(publicGatewaySource.indexOf(attachedPlan)).toBeLessThan(publicGatewaySource.indexOf(upstreamFetch))
  })

  it('keeps pre-LLM planning semantically neutral while Gemini V3 owns action selection', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      message: 'İYS entegrasyon dokümanının güncel halini incele',
      conversation: [],
      agentControllerV2Enabled: true,
    })

    expect(result.plan.intent).toBe('analysis')
    expect(result.plan.executionMode).toBe('direct')
    expect(result.plan.knowledgeRequired).toBe(false)
    expect(result.plan.webMode).toBe('none')
    expect(result.plan.evidenceQueries).toEqual([])
    expect(providerSource).toContain('requestGeminiInteractionsResponse')
    expect(providerSource).not.toContain('requestBaseWithEnterpriseEvidenceReplan')
    expect(providerSource).not.toContain('extractSemanticPlanFromItems')
  })

  it('exposes the full registered capability surface instead of letting semantic Top-K hide options', () => {
    expect(surfaceSource).toContain("discoveryMode: 'full_surface'")
    expect(surfaceSource).toContain('...runtimeTools')
    expect(surfaceSource).toContain('providerWebVisible: true')
    expect(surfaceSource).not.toContain('discoverIndexedCapabilities')
    expect(surfaceSource).not.toContain('TOP_K_DEFAULT')
  })

  it('lets Gemini choose native web/url/code and custom functions in the same interaction', () => {
    expect(interactionSource).toContain("{ type: 'google_search'")
    expect(interactionSource).toContain("{ type: 'url_context' }")
    expect(interactionSource).toContain("{ type: 'code_execution' }")
    expect(interactionSource).toContain("tool_choice: 'validated'")
    expect(interactionSource).toContain('customToolsForInteractions')
  })

  it('keeps grounding mechanical and fail-closed without choosing a semantic recovery route', () => {
    expect(coreSource).toContain('evaluateGroundedTechnicalClaims({')
    expect(coreSource).toContain('shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })')
    expect(coreSource).toContain('roundText = groundingFailureText()')
    expect(providerSource).not.toContain('[JETWORK GROUNDING RECOVERY REPLAN OBSERVATION]')
    expect(providerSource).not.toContain('grounding_controller_replan_retry')
  })
})
