import { describe, expect, it } from 'vitest'
import { windowJetbaseEvidence } from '../../../supabase/functions/_shared/jetbaseEvidenceWindow.ts'

const rows = (prefix: string, count: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, index) => ({
    canonicalKey: `${prefix}:${index}`,
    objectType: prefix,
    name: `${prefix}_${index}`,
    title: `${prefix} title ${index}`,
    summary: 's'.repeat(1200),
    evidenceExcerpt: 'e'.repeat(2400),
    ...extra,
  }))

describe('Jetbase hosted evidence transport windows', () => {
  const execution = {
    output: JSON.stringify({
      securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE',
      tool: 'retrieve_jetbase_evidence',
      citationReady: true,
      records: {
        query: 'demo evidence need',
        candidates: rows('candidate', 9),
        exact: rows('method', 6),
        relations: Array.from({ length: 20 }, (_, index) => ({
          sourceCanonicalKey: 'method:0',
          relationType: index % 2 ? 'CALLS' : 'EMITS_MESSAGE',
          targetCanonicalKey: `message:zmsg-${index}`,
          relatedCanonicalKey: `message:zmsg-${index}`,
          relatedObjectType: 'message',
          relatedName: `ZMSG-${index}`,
          relatedTitle: `ZMSG-${index}`,
          evidence: 'r'.repeat(1400),
        })),
        relatedExact: rows('message', 14),
        source: rows('source', 4, {
          verifiedSignals: { abapMessageCodes: ['ZMSG-001'] },
          sourcePagination: { hasMore: true, nextCursor: 'source:1' },
          content: 'ABAP\n' + 'x'.repeat(9000),
        }),
        documents: rows('document', 5),
        retrieval: { semanticVectorEnabled: true },
      },
    }),
    sources: [
      { sourceName: 'S1', canonicalKey: 'method:0' },
      { sourceName: 'S2', canonicalKey: 'message:0' },
    ],
    summary: { citationReady: true },
  }

  it('keeps the first hosted evidence window below the controller preview ceiling', () => {
    const result = windowJetbaseEvidence(execution, { cursor: null })
    const payload = JSON.parse(result.output)
    expect(result.output.length).toBeLessThan(10_000)
    expect(payload.evidenceWindow.hasMore).toBe(true)
    expect(payload.evidenceWindow.nextCursor).toBe('jetbase:1')
    expect(payload.evidenceWindow.relations.length).toBeLessThanOrEqual(8)
    expect(payload.evidenceWindow.source.length).toBeLessThanOrEqual(1)
  })

  it('returns a different continuation window without losing access to later evidence', () => {
    const first = windowJetbaseEvidence(execution, { cursor: null })
    const second = windowJetbaseEvidence(execution, { cursor: 'jetbase:1' })
    const firstPayload = JSON.parse(first.output)
    const secondPayload = JSON.parse(second.output)
    expect(second.output.length).toBeLessThan(10_000)
    expect(secondPayload.evidenceWindow.cursor).toBe('jetbase:1')
    expect(secondPayload.evidenceWindow.exact[0]?.canonicalKey)
      .not.toBe(firstPayload.evidenceWindow.exact[0]?.canonicalKey)
    expect(secondPayload.evidenceWindow.relations[0]?.targetCanonicalKey)
      .not.toBe(firstPayload.evidenceWindow.relations[0]?.targetCanonicalKey)
  })
})
