import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const policySource = readFileSync(new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url), 'utf8')

describe('controller-owned evidence review', () => {
  it('does not retain a runtime grounding repair/fail-closed loop', () => {
    expect(coreSource).not.toContain('[GROUNDING_REPAIR_OBSERVATION]')
    expect(coreSource).not.toContain('groundingRepairAttempted')
    expect(coreSource).not.toContain('groundingFailureText')
    expect(coreSource).not.toContain('grounding_fail_closed')
  })
  it('leaves evidence sufficiency and next-action semantics to Controller', () => {
    expect(policySource).toContain('Evidence yeterliliği, çelişki, belirsizlik ve stop/final kararı Controller LLM')
  })
})
