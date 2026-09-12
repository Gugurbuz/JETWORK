import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Agentic V2 verified knowledge evidence envelope', () => {
  const source = readFileSync(
    new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
    'utf8',
  )

  it('keeps search candidates untrusted until exact/detail verification', () => {
    expect(source).toContain("output: untrustedToolOutput('search_knowledge_catalog', records)")
    expect(source).toContain('UNTRUSTED_KNOWLEDGE_DATA')
  })

  it('uses a distinct verified envelope for exact/detail evidence', () => {
    expect(source).toContain('const verifiedToolOutput =')
    expect(source).toContain('VERIFIED_KNOWLEDGE_EVIDENCE')
    expect(source).toContain('output: verifiedToolOutput(toolName, [record])')
  })

  it('enriches exact message evidence with cursor-windowed direct relation hints without routing', () => {
    expect(source).toContain('async function getMessageDetailWithRelations')
    expect(source).toContain("direction: 'both'")
    expect(source).toContain('rawRelationCursor')
    expect(source).toContain('rawRelationWindowSize')
    expect(source).toContain('relationPagination')
    expect(source).toContain('directRelations: relationRecords.relations')
    expect(source).toContain('relatedObjects: relationRecords.objects')
    expect(source).toContain('relationHintsIncluded: true')
  })

  it('uses the verified envelope for relation evidence', () => {
    expect(source).toContain("output: verifiedToolOutput('get_related_objects', { relations, objects, pagination })")
    expect(source).toContain('nextCursor')
    expect(source).toContain('hasMore')
    expect(source).toContain('citationReady: true')
  })
})
