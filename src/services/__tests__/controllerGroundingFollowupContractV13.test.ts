import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const promptMigration = readFileSync(
  'supabase/migrations/20260909164000_controller_grounding_followup_contract_v13.sql',
  'utf8',
)
const indexMigration = readFileSync(
  'supabase/migrations/20260909163500_verified_technical_identifier_index_v2.sql',
  'utf8',
)

describe('Controller current-turn grounding contract v13', () => {
  it('keeps follow-up resolution with the Controller while requiring fresh citation-ready evidence', () => {
    expect(promptMigration).toContain('JETWORK CURRENT-TURN GROUNDING CONTRACT v1')
    expect(promptMigration).toContain('referenti konuşma bağlamından çöz')
    expect(promptMigration).toContain('bu turda uygun Jetbase knowledge capability')
    expect(promptMigration).toContain('Araç seçimini sen yaparsın')
    expect(promptMigration).toContain('Controller LLM')
    expect(promptMigration).not.toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.(?:semantic_)?(?:router|planner)/i)
  })

  it('removes only the obsolete deterministic-terminal quality assertion', () => {
    expect(promptMigration).toContain("s.slug = 'abap-short-message-111'")
    expect(promptMigration).toContain("a.field = 'deterministic_authoritative_terminal'")
    expect(promptMigration).toContain("a.kind = 'usage_gte'")
    expect(promptMigration).not.toContain("delete from public.ai_quality_scenarios")
  })

  it('indexes literal ZZ custom fields without broadening to arbitrary Z-prefixed prose', () => {
    expect(indexMigration).toContain('ZZ[A-Z0-9_]{3,}')
    expect(indexMigration).toContain("identifier ~ '^ZZ[A-Z0-9_]{3,}$'")
    expect(indexMigration).not.toContain("identifier ~ '^Z[A-Z0-9_]{2,}$'")
  })
})
