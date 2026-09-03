import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'

const controllerSurfaceSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
  'utf8',
)

describe('Agent Controller V2 exact evidence closure', () => {
  it('uses verified exact evidence before asking the user for facts already present', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('exact-evidence closure')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('kanıtta zaten bulunan bir alanı kullanıcıdan tekrar isteme')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('MESSAGE eNNN(message_class)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('verified `evidenceSignals`')
  })

  it('does not encode the reproduced message number as a routing rule', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('111 nolu')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('ZCRM_COST-111')
  })

  it('closes a bounded pending candidate set before retrying the blocked precise search', () => {
    expect(controllerSurfaceSource).toContain('exact-verify EVERY pendingCandidateKey in that batch, not a subset')
    expect(controllerSurfaceSource).toContain('retry the blocked query verbatim')
    expect(controllerSurfaceSource).toContain('must not replace retrying a more precise current-goal query')
  })

  it('preserves literal structural canonical keys instead of display rewrites', () => {
    expect(controllerSurfaceSource).toContain('literal canonicalKey exactly as returned')
    expect(controllerSurfaceSource).toContain('never rewrite canonicalKey as `CLASS=>METHOD`')
    expect(controllerSurfaceSource).toContain('`tam implementasyon mevcut değil`')
  })
})
