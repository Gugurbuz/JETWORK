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

  it('uses the verified envelope for relation evidence', () => {
    expect(source).toContain("output: verifiedToolOutput('get_related_objects', { relations, objects })")
    expect(source).toContain('citationReady: true')
  })
})
