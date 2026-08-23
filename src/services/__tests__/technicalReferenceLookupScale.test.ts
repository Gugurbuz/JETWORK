import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsTechnicalReferenceQuality.ts', import.meta.url),
  'utf8',
)
const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260823205300_paginate_technical_reference_lookup_v5.sql', import.meta.url),
  'utf8',
)

describe('technical reference lookup scale and cross references', () => {
  it('does not scan an arbitrary first-N object catalog and uses indexed candidate discovery', () => {
    expect(source).not.toContain(".select('id,canonical_key,object_type,name,title")
    expect(source).not.toMatch(/knowledge_objects_v2[\s\S]{0,400}\.limit\(120\)/u)
    expect(source).toContain("client.rpc('lookup_knowledge_technical_reference_v5'")
    expect(migrationSource).toContain("search_document @@ plainto_tsquery('simple', p.ref)")
    expect(migrationSource).toContain("v.content ilike ('%' || p.ref || '%')")
  })

  it('returns direct, graph-neighbor and cross-reference objects across types', () => {
    expect(migrationSource).toContain("'direct'::text as match_mode")
    expect(migrationSource).toContain("'relation'::text")
    expect(migrationSource).toContain("'cross_reference'::text")
    expect(source).toContain('crossReferenceCount')
    expect(source).toContain('relationNeighborCount')
    expect(source).toContain('Evidence may include other types when needed to resolve the relation')
    expect(source).toContain("matchMode === 'relation'")
  })

  it('preserves identifier boundary filtering after database discovery', () => {
    expect(source).toContain('contentReferencesTechnicalReference')
    expect(source).toContain('TECHNICAL_REFERENCE_TOOL')
    expect(source).toContain("String(record.matchMode || '') === 'direct'")
  })
})