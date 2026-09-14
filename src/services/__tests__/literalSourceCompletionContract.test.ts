import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const policy = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/literalSourceCompletionPolicy.ts', import.meta.url),
  'utf8',
)
const providers = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)
const windowed = readFileSync(
  new URL('../../../supabase/functions/_shared/abapSourceWindowTool.ts', import.meta.url),
  'utf8',
)

describe('literal source completion contract', () => {
  it('keeps literal-source completion semantic and generic', () => {
    expect(policy).toContain('never present pseudo-code')
    expect(policy).toContain('hasMore/nextCursor')
    expect(policy).toContain('full implementation body is not present or not verified')
    expect(policy).toContain('Do not blame a mechanical query limit')
    expect(policy).not.toContain('ZCRM_COST-111')
    expect(policy).not.toContain('GET_SATILABILIR_LIMIT')
  })

  it('discloses the source policy after substantive work starts without charging trivial direct turns', () => {
    expect(providers).toContain('publicWorkGate.started || input.verifiedEvidenceAvailable')
    expect(providers).toContain('LITERAL_SOURCE_COMPLETION_POLICY')
  })

  it('mechanically sanitizes verified-evidence Gemini final text before returning it', () => {
    expect(providers).toContain('sanitizeNovelCustomIdentifierClaims')
    expect(providers).toContain('verifiedToolEvidenceForAnswerability')
    expect(providers).toContain('verifiedAnswerabilityContext(input.items)')
    expect(providers).toContain('verified_answerability_sanitized_segments')
  })

  it('exposes continuation metadata for both focused and full-source windows', () => {
    expect(windowed).toContain('sourcePagination: pagination')
    expect(windowed).toContain('focusPagination: focuses.length ? pagination : undefined')
    expect(windowed).toContain('sourceNextCursor: nextCursor')
    expect(windowed).toContain('focusNextCursor: focuses.length ? nextCursor : null')
    expect(windowed).toContain('totalSourceCharacters: source.length')
  })
})
