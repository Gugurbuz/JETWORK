import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { groundingFailureText } from '../../../supabase/functions/_shared/groundingGuard.ts'

const completionMigration = readFileSync(
  'supabase/migrations/20260823125300_literal_source_line_provenance.sql',
  'utf8',
)

describe('grounding fail-closed completion contract', () => {
  it('uses the response prefix recognized by complete_assistant_turn', () => {
    const text = groundingFailureText()
    expect(text).toMatch(/^Bu teknik yanıtı güvenli biçimde tamamlayamadım:/)
    expect(completionMigration).toContain("like 'Bu teknik yanıtı güvenli biçimde tamamlayamadım:%'")
  })

  it('requires both fail-closed telemetry markers before bypassing missing-source completion rejection', () => {
    expect(completionMigration).toContain('grounding_fail_closed_marker > 0')
    expect(completionMigration).toContain('discarded_provider_text_marker > 0')
  })
})
