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

describe('production evidence-aware primary bridge', () => {
  it('routes from structured knowledge evidence without exact-identifier locks', () => {
    expect(bridge).toContain('inspectEvidence')
    expect(bridge).toContain("state = 'unresolved'")
    expect(bridge).toContain("state = 'conflict'")
    expect(bridge).toContain('evidence_unresolved_floor_flash')
    expect(bridge).toContain('evidence_conflict_floor_pro')
    expect(bridge).not.toContain('exact_identifier_lite_guard')
  })

  it('does not escalate solely because enterprise evidence is absent', () => {
    expect(bridge).toContain('No enterprise evidence is not by itself a reason to spend more model capacity.')
    expect(bridge).toContain('no_evidence_no_capacity_escalation_rule')
  })

  it('keeps routing telemetry and exposes the evidence state', () => {
    expect(bridge).toContain('primary_llm_router_calls:1')
    expect(bridge).toContain('auto_evidence_complete:1')
    expect(bridge).toContain("headers.set('x-jetwork-auto-evidence',route.evidenceState)")
  })

  it('combines authoritative resolution with the generic technical reference tool', () => {
    expect(tools).toContain("./assistantToolsTechnicalReferenceQuality.ts")
    expect(tools).toContain("'get_objects_by_technical_reference'")
    expect(tools).toContain('terminalAuthoritativeEvidence: true')
  })
})
