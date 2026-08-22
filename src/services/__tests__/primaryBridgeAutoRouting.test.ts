import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bridgeSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-primary-bridge/index.ts', import.meta.url),
  'utf8',
)

describe('Primary-agent bridge Auto routing', () => {
  it('routes only Auto requests and preserves explicit model selections', () => {
    expect(bridgeSource).toContain("if (requestedModel === AUTO_MODEL)")
    expect(bridgeSource).toContain('forwardedBody = { ...body, model: route.routedModel }')
    expect(bridgeSource).toContain("const requestedModel = cleanString(body.model || AUTO_MODEL, 80)")
  })

  it('keeps RAG and quality execution on the current openai-assistant runtime', () => {
    expect(bridgeSource).toContain('functions/v1/openai-assistant')
    expect(bridgeSource).not.toContain('functions/v1/openai-assistant-core-v2-base')
    expect(bridgeSource).not.toContain('functions/v1/openai-assistant-core-v2-router')
  })

  it('uses semantic model routing rather than keyword reflex rules', () => {
    expect(bridgeSource).toContain('Judge the meaning of the request and conversation; do not route from isolated keywords.')
    expect(bridgeSource).toContain('Recent conversation context (continuity only, not evidence)')
    expect(bridgeSource).not.toContain('exactIdentifier')
    expect(bridgeSource).not.toContain('heavyMarker')
    expect(bridgeSource).not.toContain('orchestrationMarker')
  })

  it('starts routing with Flash-Lite and keeps a conservative Flash fallback', () => {
    expect(bridgeSource).toContain("const LITE_MODEL = 'gemini-3.5-flash-lite'")
    expect(bridgeSource).toContain("const FLASH_MODEL = 'gemini-3.5-flash'")
    expect(bridgeSource).toContain("const PRO_MODEL = 'gemini-3.1-pro-preview'")
    expect(bridgeSource).toContain('PRIMARY_BRIDGE_AUTO_ROUTER_FAILED_KEEP_FLASH')
  })

  it('adds router provider cost back into turn telemetry', () => {
    expect(bridgeSource).toContain('primary_llm_router_calls: 1')
    expect(bridgeSource).toContain('estimated_cost_usd: input.route.usage.estimatedCostUsd')
    expect(bridgeSource).toContain('auto_model_routed_lite: 1')
    expect(bridgeSource).toContain('PRIMARY_BRIDGE_AUTO_TELEMETRY_PERSISTED')
  })
})
