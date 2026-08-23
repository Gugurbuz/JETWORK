import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bridge = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-primary-bridge-evidence/index.ts', import.meta.url),
  'utf8',
)
const tools = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsAuthoritativeEvidence.ts', import.meta.url),
  'utf8',
)
const provider = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersAuthoritativeTerminal.ts', import.meta.url),
  'utf8',
)

describe('production evidence-aware primary bridge', () => {
  it('keeps exact trivial turns ahead of the Auto model router', () => {
    expect(bridge).toContain("shouldUseTrivialAssistantFastPath")
    expect(bridge).toContain("functions/v1/openai-assistant-v2-internal")
    expect(bridge).toContain("PRIMARY_BRIDGE_TRIVIAL_BYPASS")
    expect(bridge).toContain("x-jetwork-trivial-fast-path")
    expect(bridge).toContain("CONTEXT_SENSITIVE_ACKNOWLEDGEMENTS = new Set(['tamam', 'ok', 'okay'])")
    expect(bridge).toContain('if(!contextSensitiveAck&&shouldUseTrivialAssistantFastPath')
    expect(bridge.indexOf("if(!contextSensitiveAck&&shouldUseTrivialAssistantFastPath")).toBeLessThan(bridge.indexOf('routeAuto({apiKey:geminiApiKey'))
  })

  it('keeps initial routing semantic-only without exact-identifier locks', () => {
    expect(bridge).toContain('Route only from semantic task complexity, conversation context, and attachment complexity.')
    expect(bridge).toContain('evidence_deferred_to_runtime')
    expect(bridge).not.toContain('inspectEvidence')
    expect(bridge).not.toContain('exact_identifier_lite_guard')
    expect(bridge).toContain('An exact identifier may start on any tier justified by semantic complexity')
  })

  it('keeps verified evidence escalation in the post-retrieval provider layer', () => {
    expect(provider).toContain('auto_runtime_escalated_flash = 1')
    expect(provider).toContain('auto_runtime_evidence_conflict = 1')
    expect(provider).toContain('effectiveModel = PRO_MODEL')
    expect(provider).toContain('firstCoverage < expectedCount')
  })

  it('does not pre-escalate merely because enterprise evidence might be complex or absent', () => {
    expect(bridge).toContain('Do not guess whether enterprise evidence exists; retrieval happens after this routing step.')
    expect(bridge).toContain('do not pre-escalate merely because evidence might be complex')
    expect(bridge).toContain("EvidenceState = 'deferred'")
  })

  it('keeps routing telemetry and exposes that evidence is deferred to runtime', () => {
    expect(bridge).toContain('primary_llm_router_calls:1')
    expect(bridge).toContain('auto_evidence_deferred_to_runtime:1')
    expect(bridge).toContain("headers.set('x-jetwork-auto-evidence',route.evidenceState)")
  })

  it('combines authoritative resolution with the generic technical reference tool', () => {
    expect(tools).toContain("./assistantToolsTechnicalReferenceQuality.ts")
    expect(tools).toContain("'get_objects_by_technical_reference'")
    expect(tools).toContain('terminalAuthoritativeEvidence: true')
  })
})