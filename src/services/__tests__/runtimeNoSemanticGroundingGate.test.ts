import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const policySource = readFileSync(new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url), 'utf8')

describe('runtime has no semantic grounding authority', () => {
  it('keeps final-answer semantics entirely in the Controller', () => {
    for (const forbidden of ['evaluateGroundedTechnicalClaims','shouldFailClosedGroundedAnswer','groundingFailureText','[GROUNDING_REPAIR_OBSERVATION]','ASSISTANT_GROUNDING_COVERAGE_BLOCKED','grounding_fail_closed']) expect(coreSource).not.toContain(forbidden)
    expect(policySource).toContain('Evidence yeterliliği, çelişki, belirsizlik ve stop/final kararı Controller LLM')
  })
  it('retains mechanical provenance telemetry only', () => {
    expect(coreSource).toContain('provenance: {')
    expect(coreSource).toContain('sourceCount: sources.length')
    expect(coreSource).toContain('semanticGroundingGate: false')
  })
})
