import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsTechnicalReferenceQuality.ts', import.meta.url),
  'utf8',
)

describe('technical reference lookup scale and cross references', () => {
  it('does not scan an arbitrary first-N object catalog', () => {
    expect(source).not.toContain(".select('id,canonical_key,object_type,name,title")
    expect(source).not.toMatch(/knowledge_objects_v2[\s\S]{0,400}\.limit\(120\)/u)
    expect(source).toContain(".ilike('content', `%${technicalReference}%`)")
  })

  it('returns cross-reference objects across types even when direct anchor types are preferred', () => {
    expect(source).toContain("matchMode: directAnchor ? 'direct' : 'cross_reference'")
    expect(source).toContain('crossReferenceCount')
    expect(source).toContain('Cross-reference evidence is still returned across all object types.')
  })

  it('preserves identifier boundary filtering after database discovery', () => {
    expect(source).toContain('contentReferencesTechnicalReference')
    expect(source).toContain("TECHNICAL_REFERENCE_TOOL")
  })
})
