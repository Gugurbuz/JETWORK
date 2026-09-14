import type { AssistantSourceRef, AssistantToolExecution } from './assistantTools.ts'
import { executeWindowedAbapSource } from './abapSourceWindowTool.ts'

export const RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME = 'retrieve_jetbase_evidence'

export const RETRIEVE_JETBASE_EVIDENCE_TOOL = {
  type: 'function',
  name: RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME,
  description: [
    'Retrieve a compact verified Jetbase evidence pack for one model-authored factual need.',
    'This is the default high-level Jetbase retrieval capability: it can combine ranked hybrid candidate search, exact-object verification, direct graph relations, related exact records and focused ABAP source windows inside one tool execution.',
    'You decide the semantic query, evidenceKinds, focusIdentifiers and relationTypes. Runtime does not decide what claim you need; it only performs retrieval/ranking/deduplication/provenance mechanics.',
    'Use primitive search/get/relation/source capabilities only when this evidence pack leaves a material gap or when you explicitly need low-level/exhaustive traversal.',
  ].join(' '),
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 1_200 },
      evidenceKinds: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', enum: ['exact', 'relations', 'source', 'document'] },
      },
      focusIdentifiers: {
        type: ['array', 'null'],
        items: { type: 'string', minLength: 1, maxLength: 180 },
      },
      relationTypes: {
        type: ['array', 'null'],
        items: {
          type: 'string',
          enum: [
            'CONTAINS','CALLS','READS','WRITES','EMITS_MESSAGE','EXTENDS','IMPLEMENTS','DOCUMENTS',
            'DEPENDS_ON','CONNECTS_TO','EXPOSES','CONSUMES','PRODUCES','USES','OWNS','TRIGGERS','RELATES_TO',
          ],
        },
      },
      relationDirection: { type: 'string', enum: ['outgoing', 'incoming', 'both'] },
      candidateWindowSize: { type: ['integer', 'null'], minimum: 1, maximum: 8 },
      sourceWindowSize: { type: ['integer', 'null'], minimum: 1, maximum: 3 },
    },
    required: [
      'query','evidenceKinds','focusIdentifiers','relationTypes','relationDirection',
      'candidateWindowSize','sourceWindowSize',
    ],
    additionalProperties: false,
  },
} as const

const clean = (value: unknown, max = 1_200) => String(value ?? '').trim().slice(0, max)
const clamp = (value: unknown, fallback: number, maximum: number) => {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(Math.trunc(parsed), maximum))
}
const unique = <T>(values: T[]) => [...new Set(values)]
const uniqueSources = (sources: AssistantSourceRef[]) => {
  const seen = new Set<string>()
  return sources.filter(source => {
    const key = `${source.sourceId || ''}|${source.canonicalKey || ''}|${source.sourceName || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
const parseRecords = (output: string): Array<Record<string, unknown>> => {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed?.records)) {
      return parsed.records.filter((item: unknown) => item && typeof item === 'object') as Array<Record<string, unknown>>
    }
    return []
  } catch {
    return []
  }
}
const parseRelationRecords = (data: unknown) => (
  Array.isArray(data) ? data : []
).filter((item: unknown) => item && typeof item === 'object') as Array<Record<string, unknown>>

const compactText = (value: unknown, max = 2_400) => {
  const text = String(value ?? '').trim()
  return text.length <= max ? text : `${text.slice(0, max)}\n[WINDOW_CONTINUES]`
}

const relevantExcerpt = (content: unknown, terms: string[], max = 2_400) => {
  const text = String(content ?? '')
  if (text.length <= max) return text
  const lowered = text.toLocaleLowerCase('en-US')
  const index = terms
    .map(term => term.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean)
    .map(term => lowered.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0]
  if (typeof index !== 'number') return compactText(text, max)
  const start = Math.max(0, index - Math.floor(max * 0.35))
  return compactText(text.slice(start, start + max), max)
}

const candidateRecord = (record: Record<string, unknown>) => ({
  canonicalKey: clean(record.canonicalKey, 320),
  objectType: clean(record.objectType, 80),
  name: clean(record.objectName ?? record.name, 240),
  title: clean(record.title, 320),
  summary: compactText(record.summary, 700),
  evidenceExcerpt: compactText(record.evidenceExcerpt, 1_200),
  score: Number(record.score || 0),
  lexicalScore: Number(record.lexicalScore || 0),
  vectorScore: Number(record.vectorScore || 0),
  sourceName: clean(record.sourceName, 240),
})

const exactRecord = (
  record: Record<string, unknown>,
  terms: string[],
) => ({
  canonicalKey: clean(record.canonicalKey, 320),
  objectType: clean(record.objectType, 80),
  name: clean(record.name, 240),
  title: clean(record.title, 320),
  summary: compactText(record.summary, 1_000),
  verifiedSignals: record.verifiedSignals,
  evidenceExcerpt: relevantExcerpt(record.content, terms, 2_400),
  sourceName: clean(record.sourceName, 240),
})

const relationRecord = (row: Record<string, unknown>) => ({
  sourceCanonicalKey: clean(row.source_canonical_key, 320),
  relationType: clean(row.relation_type, 80),
  targetCanonicalKey: clean(row.target_canonical_key, 320),
  relatedCanonicalKey: clean(row.related_canonical_key, 320),
  relatedObjectType: clean(row.related_object_type, 80),
  relatedName: clean(row.related_name, 240),
  relatedTitle: clean(row.related_title, 320),
  relatedSummary: compactText(row.related_summary, 700),
  evidence: compactText(row.evidence, 1_000),
  sourceName: clean(row.source_name, 240),
})

const exactCanonicalCandidates = (focusIdentifiers: string[]) => unique(
  focusIdentifiers.flatMap(identifier => {
    const raw = identifier.trim()
    if (!raw) return []
    if (/^[a-z_]+:/iu.test(raw)) return [raw.toLocaleLowerCase('en-US')]
    const message = raw.toLocaleUpperCase('en-US').match(/^([A-Z][A-Z0-9_]*)-(\d{2,4})$/u)
    if (message?.[1] && message?.[2]) {
      return [`message:${message[1].toLocaleLowerCase('en-US')}-${String(message[2]).padStart(3, '0')}`]
    }
    return []
  }),
)

const getExact = async (client: any, workspaceId: string, canonicalKey: string) => {
  const { data, error } = await client.rpc('get_knowledge_object_v2', {
    p_workspace_id: workspaceId,
    p_canonical_key: canonicalKey,
    p_object_types: null,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    record: {
      scope: row.scope_type === 'project' ? 'project' : 'global',
      canonicalKey: row.canonical_key,
      objectType: row.object_type,
      name: row.object_name,
      title: row.title,
      summary: row.summary,
      content: row.content,
      sourceName: row.source_name,
    } as Record<string, unknown>,
    source: {
      sourceId: row.source_id ? String(row.source_id) : undefined,
      sourceName: String(row.source_name || 'Kurumsal bilgi kaynağı'),
      canonicalKey: row.canonical_key ? String(row.canonical_key) : undefined,
      objectType: row.object_type ? String(row.object_type) : undefined,
      title: row.title ? String(row.title) : row.object_name ? String(row.object_name) : undefined,
    } as AssistantSourceRef,
  }
}

const getRelations = async (input: {
  client: any
  workspaceId: string
  canonicalKey: string
  relationTypes: string[] | null
  direction: string
}) => {
  const { data, error } = await input.client.rpc('get_related_knowledge_objects_v2', {
    p_workspace_id: input.workspaceId,
    p_canonical_key: input.canonicalKey,
    p_relation_types: input.relationTypes?.length ? input.relationTypes : null,
    p_direction: input.direction,
    p_limit: 20,
  })
  if (error) throw error
  return parseRelationRecords(data)
}

export const executeRetrieveJetbaseEvidence = async (input: {
  client: any
  workspaceId: string
  args: Record<string, unknown>
  search: (
    client: any,
    workspaceId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<AssistantToolExecution>
}): Promise<AssistantToolExecution> => {
  const query = clean(input.args.query, 1_200)
  if (query.length < 2) throw new Error('query is required.')

  const evidenceKinds = unique(
    (Array.isArray(input.args.evidenceKinds) ? input.args.evidenceKinds : [])
      .map(value => clean(value, 40))
      .filter(value => ['exact','relations','source','document'].includes(value)),
  )
  const focusIdentifiers = unique(
    (Array.isArray(input.args.focusIdentifiers) ? input.args.focusIdentifiers : [])
      .map(value => clean(value, 180))
      .filter(Boolean),
  )
  const relationTypes = Array.isArray(input.args.relationTypes)
    ? unique(input.args.relationTypes.map(value => clean(value, 80)).filter(Boolean))
    : null
  const direction = ['outgoing','incoming','both'].includes(String(input.args.relationDirection))
    ? String(input.args.relationDirection)
    : 'both'
  const candidateWindowSize = clamp(input.args.candidateWindowSize, 4, 8)
  const sourceWindowSize = clamp(input.args.sourceWindowSize, 2, 3)
  const terms = unique([query, ...focusIdentifiers])

  const searchResult = await input.search(input.client, input.workspaceId, 'search_knowledge_catalog', {
    query,
    limit: candidateWindowSize,
  })
  const rankedCandidates = parseRecords(searchResult.output).map(candidateRecord)

  const canonicalKeys = unique([
    ...exactCanonicalCandidates(focusIdentifiers),
    ...rankedCandidates.map(candidate => candidate.canonicalKey).filter(Boolean),
  ]).slice(0, candidateWindowSize)

  const exactSettled = await Promise.all(canonicalKeys.map(async canonicalKey => {
    try { return await getExact(input.client, input.workspaceId, canonicalKey) } catch { return null }
  }))
  const exactResolved = exactSettled.filter(Boolean) as Array<NonNullable<Awaited<ReturnType<typeof getExact>>>>
  const exactByKey = new Map(exactResolved.map(item => [clean(item.record.canonicalKey, 320), item]))
  const exacts = exactResolved.map(item => exactRecord(item.record, terms))
  const sources: AssistantSourceRef[] = exactResolved.map(item => item.source)

  const relationRows: Array<Record<string, unknown>> = []
  if (evidenceKinds.includes('relations') || evidenceKinds.includes('source')) {
    const relationResults = await Promise.all(exactResolved.map(async item => {
      const canonicalKey = clean(item.record.canonicalKey, 320)
      if (!canonicalKey) return []
      try {
        return await getRelations({
          client: input.client,
          workspaceId: input.workspaceId,
          canonicalKey,
          relationTypes,
          direction,
        })
      } catch {
        return []
      }
    }))
    relationRows.push(...relationResults.flat())
  }
  const compactRelations = unique(
    relationRows.map(row => JSON.stringify(relationRecord(row))),
  ).map(value => JSON.parse(value) as Record<string, unknown>)

  const relatedKeys = unique(
    compactRelations
      .map(row => clean(row.relatedCanonicalKey, 320))
      .filter(Boolean),
  )
  const relatedExactResults = await Promise.all(relatedKeys.map(async canonicalKey => {
    if (exactByKey.has(canonicalKey)) return exactByKey.get(canonicalKey) || null
    try { return await getExact(input.client, input.workspaceId, canonicalKey) } catch { return null }
  }))
  const relatedResolved = relatedExactResults.filter(Boolean) as Array<NonNullable<Awaited<ReturnType<typeof getExact>>>>
  const relatedExacts = relatedResolved.map(item => exactRecord(item.record, terms))
  sources.push(...relatedResolved.map(item => item.source))

  const sourceTargets = unique([
    ...exactResolved
      .filter(item => ['class','method','function'].includes(clean(item.record.objectType, 80)))
      .map(item => clean(item.record.canonicalKey, 320)),
    ...relatedResolved
      .filter(item => ['class','method','function'].includes(clean(item.record.objectType, 80)))
      .map(item => clean(item.record.canonicalKey, 320)),
  ]).filter(Boolean)

  const sourceWindows: Array<Record<string, unknown>> = []
  if (evidenceKinds.includes('source')) {
    const sourceResults = await Promise.all(sourceTargets.map(async canonicalKey => {
      try {
        return await executeWindowedAbapSource({
          client: input.client,
          workspaceId: input.workspaceId,
          canonicalKey,
          focusIdentifiers,
          sourceCursor: null,
          windowSize: sourceWindowSize,
        })
      } catch {
        return null
      }
    }))
    for (const result of sourceResults.filter(Boolean) as AssistantToolExecution[]) {
      sources.push(...result.sources)
      for (const record of parseRecords(result.output)) {
        sourceWindows.push({
          canonicalKey: clean(record.canonicalKey, 320),
          objectType: clean(record.objectType, 80),
          name: clean(record.name, 240),
          focusIdentifiers: record.focusIdentifiers,
          sourcePagination: record.sourcePagination,
          verifiedSignals: record.verifiedSignals,
          content: compactText(record.content, 7_500),
          sourceName: clean(record.sourceName, 240),
        })
      }
    }
  }

  const documentExacts = evidenceKinds.includes('document')
    ? exacts.filter(record => ['document','business_rule'].includes(record.objectType))
    : []

  const citationReady = exacts.length > 0 || relatedExacts.length > 0 || sourceWindows.length > 0
  const records = {
    query,
    candidates: rankedCandidates,
    exact: evidenceKinds.includes('exact') ? exacts : [],
    relations: compactRelations,
    relatedExact: relatedExacts,
    source: sourceWindows,
    documents: documentExacts,
    retrieval: {
      candidateWindowSize,
      candidateCount: rankedCandidates.length,
      exactCount: exacts.length,
      relationCount: compactRelations.length,
      relatedExactCount: relatedExacts.length,
      sourceWindowCount: sourceWindows.length,
      semanticVectorEnabled: searchResult.summary?.semanticVectorEnabled === true,
      modelAuthoredEvidenceKinds: evidenceKinds,
      modelAuthoredFocusIdentifiers: focusIdentifiers,
      modelAuthoredRelationTypes: relationTypes,
      relationDirection: direction,
    },
  }

  return {
    output: JSON.stringify({
      securityNotice: citationReady
        ? 'VERIFIED_KNOWLEDGE_EVIDENCE. Exact/relation/source records in this pack were resolved against current published Jetbase data. Candidate records remain discovery-only.'
        : 'UNTRUSTED_KNOWLEDGE_DATA. No exact published Jetbase evidence was resolved; candidates are discovery-only.',
      tool: RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME,
      citationReady,
      records,
    }),
    sources: citationReady ? uniqueSources(sources) : [],
    summary: {
      citationReady,
      query,
      candidateCount: rankedCandidates.length,
      exactCount: exacts.length,
      relationCount: compactRelations.length,
      relatedExactCount: relatedExacts.length,
      sourceWindowCount: sourceWindows.length,
      retrievalEngine: 'jetbase-evidence-pack-v1',
      internalSearchCalls: 1,
      internalExactReads: exactResolved.length + relatedResolved.length,
      internalRelationReads: evidenceKinds.includes('relations') || evidenceKinds.includes('source') ? exactResolved.length : 0,
      internalSourceReads: sourceWindows.length,
    },
  }
}
