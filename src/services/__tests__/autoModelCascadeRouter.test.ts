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

  it('starts Auto at Lite and escalates in order', () => {
    expect(routerSource).toContain("const LITE_MODEL = 'gemini-3.5-flash-lite'")
    expect(routerSource).toContain("const FLASH_MODEL = 'gemini-3.5-flash'")
    expect(routerSource).toContain("const PRO_MODEL = 'gemini-3.1-pro-preview'")
    expect(routerSource).toContain("'USE_LITE', 'ESCALATE_COMPLEX', 'ESCALATE_CONTEXT', 'ESCALATE_ORCHESTRATION'")
    expect(routerSource).toContain("allowed: ['USE_FLASH', 'ESCALATE_PRO']")
  })

  it('vetoes model self-escalation when deterministic request signals do not support it', () => {
    expect(routerSource).toContain("reasons: ['exact_identifier_lite_guard']")
    expect(routerSource).toContain('lite_escalation_vetoed_by_policy')
    expect(routerSource).toContain('pro_escalation_vetoed_by_policy')
    expect(routerSource).toContain("flashDecision === 'ESCALATE_PRO' && profile.allowPro")
  })

  it('keeps short exact enterprise identifier lookups on Lite', () => {
    expect(routerSource).toContain('exactIdentifier')
    expect(routerSource).toContain('message.length <= 320')
    expect(routerSource).toContain('words <= 24')
    expect(routerSource).toContain('allowFlash: false')
    expect(routerSource).toContain('allowPro: false')
    expect(routerSource).toContain('A knowledge lookup that may return zero records is still a Lite-capable task.')
  })

  it('uses conservative fallbacks so malformed classifier output does not increase cost', () => {
    expect(routerSource).toContain("fallback: 'USE_LITE'")
    expect(routerSource).toContain("fallback: 'USE_FLASH'")
    expect(routerSource).toContain('lite_classifier_error_keep_lite')
    expect(routerSource).toContain('flash_classifier_error_keep_flash')
  })

  it('adds classifier provider cost and route attribution back to turn telemetry with retry', () => {
    expect(routerSource).toContain('estimated_cost_usd: item.estimatedCostUsd')
    expect(routerSource).toContain('primary_llm_router_calls: 1')
    expect(routerSource).toContain('auto_model_cascade_started: 1')
    expect(routerSource).toContain('autoModelCascade:')
    expect(routerSource).toContain('AUTO_CASCADE_TELEMETRY_PERSISTED')
    expect(routerSource).toContain('[0, 100, 300, 800, 1_500]')
  })

  it('forwards to an immutable base core function instead of recursing into itself', () => {
    expect(routerSource).toContain("const BASE_CORE_SLUG = 'openai-assistant-core-v2-base'")
    expect(routerSource).toContain('functions/v1/${BASE_CORE_SLUG}')
    expect(routerSource).not.toContain("functions/v1/openai-assistant-core-v2`")
  })
})
