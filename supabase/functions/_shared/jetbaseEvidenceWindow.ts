type SourceRef = {
  sourceId?: string
  sourceName: string
  canonicalKey?: string
  objectType?: string
  title?: string
}

type ToolExecution = {
  output: string
  sources: SourceRef[]
  summary: Record<string, unknown>
}

const clean = (value: unknown, max: number) => {
  const text = String(value ?? '').trim()
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

const asRecords = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  : []

const pageFromCursor = (value: unknown) => {
  const match = String(value ?? '').trim().match(/^jetbase:(\d+)$/u)
  return match?.[1] ? Math.max(0, Number(match[1]) || 0) : 0
}

const candidate = (row: Record<string, unknown>) => ({
  canonicalKey: clean(row.canonicalKey, 220),
  objectType: clean(row.objectType, 48),
  name: clean(row.name, 160),
  title: clean(row.title, 180),
  score: Number(row.score || 0),
})

const exact = (row: Record<string, unknown>) => ({
  canonicalKey: clean(row.canonicalKey, 220),
  objectType: clean(row.objectType, 48),
  name: clean(row.name, 160),
  title: clean(row.title, 180),
  summary: clean(row.summary, 420),
  verifiedSignals: row.verifiedSignals,
  evidenceExcerpt: clean(row.evidenceExcerpt, 850),
})

const relation = (row: Record<string, unknown>) => ({
  sourceCanonicalKey: clean(row.sourceCanonicalKey, 220),
  relationType: clean(row.relationType, 60),
  targetCanonicalKey: clean(row.targetCanonicalKey, 220),
  relatedCanonicalKey: clean(row.relatedCanonicalKey, 220),
  relatedObjectType: clean(row.relatedObjectType, 48),
  relatedName: clean(row.relatedName, 160),
  relatedTitle: clean(row.relatedTitle, 180),
  evidence: clean(row.evidence, 360),
})

const source = (row: Record<string, unknown>) => ({
  canonicalKey: clean(row.canonicalKey, 220),
  objectType: clean(row.objectType, 48),
  name: clean(row.name, 160),
  verifiedSignals: row.verifiedSignals,
  sourcePagination: row.sourcePagination,
  content: clean(row.content, 2_800),
})

const document = (row: Record<string, unknown>) => ({
  canonicalKey: clean(row.canonicalKey, 220),
  objectType: clean(row.objectType, 48),
  title: clean(row.title, 180),
  summary: clean(row.summary, 420),
  evidenceExcerpt: clean(row.evidenceExcerpt, 850),
})

const slicePage = <T>(values: T[], page: number, size: number) =>
  values.slice(page * size, page * size + size)

const hasNextPage = (page: number, sections: Array<[unknown[], number]>) =>
  sections.some(([values, size]) => (page + 1) * size < values.length)

export const windowJetbaseEvidence = (
  execution: ToolExecution,
  args: Record<string, unknown>,
): ToolExecution => {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(execution.output) as Record<string, unknown>
  } catch {
    return execution
  }

  const records = parsed.records && typeof parsed.records === 'object' && !Array.isArray(parsed.records)
    ? parsed.records as Record<string, unknown>
    : {}
  const candidates = asRecords(records.candidates)
  const exacts = asRecords(records.exact)
  const relations = asRecords(records.relations)
  const related = asRecords(records.relatedExact)
  const sources = asRecords(records.source)
  const documents = asRecords(records.documents)
  const page = pageFromCursor(args.cursor)

  const candidatePage = slicePage(candidates, page, 3).map(candidate)
  const exactPage = slicePage(exacts, page, 2).map(exact)
  const relationPage = slicePage(relations, page, 8).map(relation)
  const relatedPage = slicePage(related, page, 6).map(exact)
  const sourcePage = slicePage(sources, page, 1).map(source)
  const documentPage = slicePage(documents, page, 2).map(document)
  const hasMore = hasNextPage(page, [
    [candidates, 3],
    [exacts, 2],
    [relations, 8],
    [related, 6],
    [sources, 1],
    [documents, 2],
  ])
  const nextCursor = hasMore ? `jetbase:${page + 1}` : null

  const visibleCanonicalKeys = new Set<string>()
  for (const row of [...candidatePage, ...exactPage, ...relationPage, ...relatedPage, ...sourcePage, ...documentPage]) {
    for (const key of ['canonicalKey','sourceCanonicalKey','targetCanonicalKey','relatedCanonicalKey']) {
      const value = String((row as Record<string, unknown>)[key] || '')
      if (value) visibleCanonicalKeys.add(value)
    }
  }
  const visibleSources = execution.sources.filter(ref =>
    !ref.canonicalKey || visibleCanonicalKeys.has(String(ref.canonicalKey))
  )

  const compact = {
    securityNotice: parsed.securityNotice,
    tool: parsed.tool,
    citationReady: parsed.citationReady === true,
    query: records.query,
    evidenceWindow: {
      cursor: args.cursor ?? null,
      nextCursor,
      hasMore,
      page,
      candidates: candidatePage,
      exact: exactPage,
      relations: relationPage,
      relatedExact: relatedPage,
      source: sourcePage,
      documents: documentPage,
    },
    retrieval: records.retrieval,
    instruction: hasMore
      ? 'This is one ranked evidence transport window. Use nextCursor only if a material evidence gap remains; otherwise finalize from the verified evidence already present.'
      : 'This ranked evidence window is complete for the retrieved pack. If it closes the user goal, finalize; use a primitive capability only for a concrete remaining evidence gap.',
  }
  const output = JSON.stringify(compact)
  return {
    output,
    sources: visibleSources,
    summary: {
      ...execution.summary,
      evidenceWindowed: true,
      evidenceWindowPage: page,
      evidenceWindowCharacters: output.length,
      evidenceWindowHasMore: hasMore,
      evidenceWindowNextCursor: nextCursor,
      fullEvidenceCharacters: execution.output.length,
    },
  }
}
