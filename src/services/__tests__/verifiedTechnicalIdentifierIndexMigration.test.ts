import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260909161000_verified_technical_identifier_index_v1.sql',
  'utf8',
)

describe('Jetbase verified technical identifier index v1', () => {
  it('indexes exact canonical parent/leaf aliases and full-source technical identifiers before truncation', () => {
    expect(migration).toContain('with_verified_technical_identifier_index_v1')
    expect(migration).toContain('[VERIFIED_TECHNICAL_IDENTIFIERS]')
    expect(migration).toContain("split_part(canonical_identifier, '/', 1)")
    expect(migration).toContain("split_part(canonical_identifier, '/', 2)")
    expect(migration).toContain('Z[A-Z0-9]*_[A-Z0-9_]+')
    expect(migration).toContain('MESSAGE[[:space:]]+')
    expect(migration).toContain('r.resolved_content')
  })

  it('keeps the index mechanical and preserves exact-object access controls', () => {
    expect(migration).toContain('security invoker')
    expect(migration).toContain('security definer')
    expect(migration).toContain('revoke all on function public.with_verified_technical_identifier_index_v1')
    expect(migration).toContain('grant execute on function public.get_knowledge_object_v2')
    expect(migration).not.toMatch(/semantic\s+(router|routing|planner)/i)
  })
})
