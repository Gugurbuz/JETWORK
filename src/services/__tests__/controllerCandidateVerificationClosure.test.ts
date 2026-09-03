import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy'

describe('agent controller candidate verification closure', () => {
  it('requires exact verification before repeated broad search when a plausible candidate exists', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Candidate-verification closure uygula')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('exact/detail capability ile doğrulamadan aynı hedef için yeni bir broad search')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('broad search döngüsü oluşturma')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('runtime bunu keyword veya identifier ile route etmez')
  })
})
