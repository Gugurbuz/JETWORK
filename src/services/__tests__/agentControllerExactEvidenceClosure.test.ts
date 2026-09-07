import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'

const controllerSurfaceSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
  'utf8',
)
const assistantToolsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
  'utf8',
)
const groundingSource = readFileSync(
  new URL('../../../supabase/functions/_shared/groundingGuard.ts', import.meta.url),
  'utf8',
)

describe('Agent Controller V3 exact-evidence boundary', () => {
  it('keeps unsupported exact technical claims fail-closed without prescribing retrieval order', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Kuruma özgü veya exact teknik bir iddiayı')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Kanıt eksikse eksikliği açıkça söyle')
    expect(assistantToolsSource).toContain('VERIFIED_KNOWLEDGE_EVIDENCE')
    expect(assistantToolsSource).toContain('citationReady: true')
    expect(groundingSource).toContain('evaluateGroundedTechnicalClaims')
    expect(groundingSource).toContain('shouldFailClosedGroundedAnswer')
  })

  it('does not encode a reproduced message number as a routing rule', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('111 nolu')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('ZCRM_COST-111')
  })

  it('does not restore the hidden candidate-verification state machine', () => {
    expect(controllerSurfaceSource).not.toContain('pendingCandidateKey')
    expect(controllerSurfaceSource).not.toContain('retry the blocked query verbatim')
    expect(assistantToolsSource).not.toContain('SEARCH_CANDIDATES_REQUIRE_EXACT_VERIFICATION')
    expect(assistantToolsSource).not.toContain('protocolBlocked')
    expect(assistantToolsSource).not.toContain('pendingSearchVerificationByClient')
  })

  it('preserves canonical identity mechanically in exact records instead of prompt-level display rewrites', () => {
    expect(assistantToolsSource).toContain('canonicalKey: row.canonical_key')
    expect(assistantToolsSource).toContain('p_canonical_key: canonicalKey')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('CLASS=>METHOD')
    expect(controllerSurfaceSource).not.toContain('never rewrite canonicalKey')
  })
})
