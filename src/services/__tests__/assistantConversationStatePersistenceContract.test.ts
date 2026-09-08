import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260908164500_preserve_assistant_conversation_state.sql', import.meta.url),
  'utf8',
)

describe('assistant conversation state persistence contract', () => {
  it('persists the validated compact state emitted by the controller runtime', () => {
    expect(migration).toContain("jsonb_typeof(p_state_items) <> 'array'")
    expect(migration).toContain('clean_state_items := p_state_items;')
    expect(migration).toContain('state_items = clean_state_items')
  })

  it('keeps the existing fail-closed enterprise and literal-source guards', () => {
    expect(migration).toContain('ENTERPRISE_GROUNDING_REQUIRED_NO_VERIFIED_SOURCE')
    expect(migration).toContain('UNVERIFIED_LITERAL_SOURCE_CODE_LINE')
    expect(migration).toContain('grounding_unverified_provider_text_discarded')
  })

  it('does not replace durable state with a hard-coded empty array at update time', () => {
    expect(migration).not.toMatch(/state_items\s*=\s*'\[\]'::jsonb/u)
  })
})
