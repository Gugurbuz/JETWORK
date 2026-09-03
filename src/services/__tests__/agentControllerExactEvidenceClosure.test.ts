import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'

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
})
