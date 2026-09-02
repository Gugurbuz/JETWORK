import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GEMINI_AGENT_MODEL,
  GEMINI_SEMANTIC_MODEL,
  buildGeminiFinalSynthesisItems,
  compactGeminiAgentItems,
  normalizeGeminiRequestedModel,
  toolBudgetForPlan,
  usageWithGeminiEstimatedCost,
} from '../../../supabase/functions/_shared/geminiCostGuard'

const providerWrapperSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
)
const controllerPolicySource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
)
const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
  'utf8',
)
const gatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url),
  'utf8',
)
const settingsStoreSource = readFileSync(
  new URL('../../store/useSettingsStore.ts', import.meta.url),
  'utf8',
)
const liveCanaryWorkflow = readFileSync(
  new URL('../../../.github/workflows/reasoning-live-canary.yml', import.meta.url),
  'utf8',
)

describe('Gemini cost and primary-agent boundaries', () => {
  it('keeps stable model normalization and legacy budget helpers available', () => {
    expect(GEMINI_SEMANTIC_MODEL).toBe('gemini-3.1-flash-lite')
    expect(GEMINI_AGENT_MODEL).toBe('gemini-3.5-flash-lite')
    expect(normalizeGeminiRequestedModel('gemini-3.1-flash-lite-preview')).toBe('gemini-3.1-flash-lite')
    expect(settingsStoreSource).not.toContain('model === FLASH_LITE_MODEL ? GEMINI_PRO_MODEL')
    expect(settingsStoreSource).toContain("STABLE_FLASH_LITE_MODEL = 'gemini-3.5-flash-lite'")

    const base = {
      complexity: 'medium', knowledgeRequired: true, webMode: 'none', verificationRequired: false,
    } as any
    expect(toolBudgetForPlan({ ...base, intent: 'sap_diagnosis' })).toBe(4)
  })

  it('lets the requested Gemini model own normal tool decisions under the shared controller policy', () => {
    expect(providerWrapperSource).toContain('const requestedModel = normalizeGeminiRequestedModel(input.model)')
    expect(providerWrapperSource).toContain('model: requestedModel')
    expect(providerWrapperSource).toContain('const primaryAgentInstruction = AGENT_CONTROLLER_INSTRUCTION')
    expect(controllerPolicySource).toContain('Deterministic routing avoidance')
    expect(controllerPolicySource).toContain('semantik seçimi controller modeli yapar')
    expect(providerWrapperSource).toContain('primary_llm_agent_calls')
    expect(providerWrapperSource).not.toContain('buildDeterministicKnowledgeDispatch')
    expect(providerWrapperSource).not.toContain('shouldUseDeterministicKnowledgeDispatch')
    expect(providerWrapperSource).not.toContain('model: GEMINI_AGENT_MODEL')
  })

  it('does not wire deterministic inventory shortcuts into the active provider layer', () => {
    expect(providerWrapperSource).not.toContain('buildEnumerationFastPathDispatch')
    expect(providerWrapperSource).not.toContain('buildSyntheticEnumerationFunctionCall')
    expect(providerWrapperSource).not.toContain('deterministic_enumeration_dispatch')
    expect(providerWrapperSource).toContain('compactResolvedConversationItems')
  })

  it('removes the paid semantic provider preflight from execution authority', () => {
    expect(semanticSource).toContain("SEMANTIC_ORCHESTRATOR_VERSION = 'primary-llm-agent-v1'")
    expect(semanticSource).toContain('semantic_planner_provider_calls_avoided')
    expect(semanticSource).not.toContain('OPENAI_RESPONSES_URL')
    expect(semanticSource).not.toContain('GEMINI_GENERATE_CONTENT_BASE_URL')
    expect(semanticSource).not.toContain('requestGeminiPlan')
    expect(semanticSource).not.toContain('requestOpenAiPlan')
  })

  it('keeps evidence compaction helpers valid for compatibility paths', () => {
    const hugeEvidence = 'E'.repeat(20_000)
    const items: Array<Record<string, unknown>> = [
      { role: 'user', content: 'Teklife cost eklerken uyumsuz hatası aldım.' },
      { type: 'function_call', call_id: 'c1', name: 'knowledge_search', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: hugeEvidence },
      { type: 'function_call', call_id: 'c2', name: 'knowledge_detail', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c2', output: hugeEvidence },
    ]

    const agentItems = compactGeminiAgentItems(items)
    const compactedOutputs = agentItems
      .filter(item => 'type' in item && item.type === 'function_call_output')
      .map(item => String('output' in item ? item.output || '' : ''))
    expect(compactedOutputs).toHaveLength(2)
    expect(Math.max(...compactedOutputs.map(value => value.length))).toBeLessThanOrEqual(4_500)

    const finalItems = buildGeminiFinalSynthesisItems(items, 'taslak')
    expect(JSON.stringify(finalItems)).toContain('[JETWORK_TOOL_EVIDENCE]')
  })

  it('records a conservative Gemini cost estimate in usage metadata', () => {
    const usage = usageWithGeminiEstimatedCost('gemini-3.5-flash-lite', {
      input_tokens: 10_000,
      output_tokens: 1_000,
      reasoning_tokens: 0,
      total_tokens: 11_000,
    })
    expect(usage?.estimated_cost_usd).toBeCloseTo(0.0055, 6)
  })

  it('keeps Auto provider fallback wiring intact', () => {
    expect(gatewaySource).toContain("DEFAULT_GEMINI_RUNTIME_MODEL = 'gemini-3.5-flash'")
    expect(gatewaySource).toContain('preferGeminiAuto')
    expect(gatewaySource).toContain('AUTO_PROVIDER_CIRCUIT_BREAKER_MS')
  })

  it('never runs the paid production continuity canary automatically', () => {
    expect(liveCanaryWorkflow).toContain('workflow_dispatch:')
    expect(liveCanaryWorkflow).not.toContain('\n  push:')
  })
})