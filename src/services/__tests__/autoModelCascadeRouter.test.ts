import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routerSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-router-v2/index.ts', import.meta.url),
  'utf8',
)

describe('Auto model cascade core router', () => {
  it('keeps explicit model selections out of Auto routing', () => {
    expect(routerSource).toContain("if (requestedModel === AUTO_MODEL)")
    expect(routerSource).toContain("let forwardedBody = body")
    expect(routerSource).toContain("forwardedBody = { ...body, model: decision.routedModel }")
  })

  it('routes Auto from Lite to Flash and only then to Pro', () => {
    expect(routerSource).toContain("const LITE_MODEL = 'gemini-3.5-flash-lite'")
    expect(routerSource).toContain("const FLASH_MODEL = 'gemini-3.5-flash'")
    expect(routerSource).toContain("const PRO_MODEL = 'gemini-3.1-pro-preview'")
    expect(routerSource).toContain("allowed: ['USE_LITE', 'ESCALATE']")
    expect(routerSource).toContain("allowed: ['USE_FLASH', 'ESCALATE_PRO']")
  })

  it('does not escalate merely because enterprise evidence is missing', () => {
    expect(routerSource).toContain('Missing enterprise evidence is NOT a reason to escalate')
    expect(routerSource).toContain('Missing enterprise evidence is NOT a reason to choose Pro')
  })

  it('uses deterministic floors only for genuinely heavier requests', () => {
    expect(routerSource).toContain("reasons.push('attachment_context')")
    expect(routerSource).toContain("reasons.push('multi_step_complexity')")
    expect(routerSource).toContain("reasons.push('artifact_orchestration')")
    expect(routerSource).not.toContain("reasons.push('missing_evidence')")
  })

  it('adds classifier provider cost and route attribution back to turn telemetry', () => {
    expect(routerSource).toContain('estimated_cost_usd: item.estimatedCostUsd')
    expect(routerSource).toContain('primary_llm_router_calls: 1')
    expect(routerSource).toContain('auto_model_cascade_started: 1')
    expect(routerSource).toContain('autoModelCascade:')
    expect(routerSource).toContain('routedModel: input.decision.routedModel')
  })

  it('forwards to an immutable base core function instead of recursing into itself', () => {
    expect(routerSource).toContain("const BASE_CORE_SLUG = 'openai-assistant-core-v2-base'")
    expect(routerSource).toContain('functions/v1/${BASE_CORE_SLUG}')
    expect(routerSource).not.toContain("functions/v1/openai-assistant-core-v2`")
  })
})
