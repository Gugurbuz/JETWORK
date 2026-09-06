import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy'

describe('agent controller retrieval authority v3', () => {
  it('leaves candidate follow-up and repeated search decisions to the controller model', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('arama sorgusuna ve filtrelere')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('observation sonrasında sıradaki aksiyona sen karar ver')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('yeterli kanıt varsa dur, yetersizse re-plan et')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('Candidate-verification closure uygula')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('exact/detail capability ile doğrulamadan aynı hedef için yeni bir broad search')
    expect(AGENT_CONTROLLER_INSTRUCTION).not.toContain('protocolBlocked')
  })
})
