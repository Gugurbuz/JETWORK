import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v3/index.ts', import.meta.url),
  'utf8',
)

describe('controller v3 evidence completion policy', () => {
  it('keeps exact-evidence completion with the same Controller LLM', () => {
    expect(source).toContain('EVIDENCE_COMPLETION_POLICY:')
    expect(source).toContain('candidate-specific evidence lineage')
    expect(source).toContain('Capability choice, query formulation, evidence traversal, further research, and the stop/final decision remain solely yours as the Controller LLM.')
    expect(source).toContain('This policy does not select a tool, query, route, or answer.')
  })

  it('does not hard-code the production smoke identifiers or recovery tools', () => {
    const start = source.indexOf('const CONTROLLER_EVIDENCE_COMPLETION_POLICY')
    const end = source.indexOf("].join(' ')", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const policy = source.slice(start, end)
    expect(policy).not.toContain('ZCRM_COST-111')
    expect(policy).not.toContain('GET_SATILABILIR_LIMIT')
    expect(policy).not.toContain('get_message_detail')
    expect(policy).not.toContain('get_abap_source')
    expect(policy).not.toContain('get_related_objects')
    expect(policy).not.toContain('get_knowledge_evidence_pack')
    expect(policy).not.toContain('search_knowledge_catalog')
  })

  it('preserves model choice over broad search versus candidate-specific traversal', () => {
    const start = source.indexOf('const CONTROLLER_EVIDENCE_COMPLETION_POLICY')
    const end = source.indexOf("].join(' ')", start)
    const policy = source.slice(start, end)
    expect(policy).toContain('broad enumeration is still available when you judge that competing candidates remain materially plausible')
    expect(policy).toContain('continue candidate-specific evidence traversal until you can either verify the requested literal/source or establish from available evidence that no verified body is present')
  })

  it('preserves provider recovery while applying the policy to every Gemini interaction', () => {
    expect(source).toContain('withControllerEvidenceCompletionPolicy(parsedBody)')
    expect(source).toContain("model: RECOVERY_GEMINI_MODEL")
    expect(source).toContain("String(body.model || '') !== PRIMARY_GEMINI_MODEL")
  })
})
