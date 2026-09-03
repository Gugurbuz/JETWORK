import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy'

describe('agent controller ABAP message normalization', () => {
  it('requires canonical CLASS-NNN alongside verified MESSAGE syntax', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Kanonik mesaj kodunu mekanik biçimde `MESSAGE_CLASS-NNN` olarak üret')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('hem gerçek source sözdizimini hem bu kanonik kodu belirt')
  })
})
