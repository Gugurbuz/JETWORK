import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260909214000_jetbase_literal_identifier_recall_v1.sql', import.meta.url),
  'utf8',
)

const assistantTools = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
  'utf8',
)

describe('Jetbase literal identifier recall v1', () => {
  it('uses the exact model-authored query beside the existing hybrid engine', () => {
    expect(migration).toContain("lower(trim(coalesce(p_query, ''))) as q")
    expect(migration).toContain('public.hybrid_search_knowledge_catalog_v2_raw(')
    expect(migration).toContain("lower(o.canonical_key) like '%' || a.q || '%'")
    expect(migration).toContain("lower(coalesce(o.published_name, '')) like '%' || a.q || '%'")
  })

  it('preserves project-over-global precedence and published-source pinning', () => {
    expect(migration).toContain("'project'::text as scope_type, 0 as scope_rank")
    expect(migration).toContain("'global'::text as scope_type, 1 as scope_rank")
    expect(migration).toContain("s.published_version_id = sv.id")
    expect(migration).toContain('partition by o.canonical_key')
  })

  it('does not reintroduce runtime query expansion or smoke-specific routing', () => {
    expect(assistantTools).toContain('return exact ? [exact] : []')
    expect(migration).not.toContain('ZCRM_COST-111')
    expect(migration).not.toContain('GET_SATILABILIR_LIMIT')
    expect(migration).not.toContain('CHECK_ZTKS')
  })
})
