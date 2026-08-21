import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as productionExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsEvidenceBoundaryV2.ts'
import { executeAssistantTool as technicalBaseExecuteAssistantTool } from './assistantToolsTechnicalReferenceQuality.ts'

export * from './assistantToolsEvidenceBoundaryV2.ts'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const familyPrefix = (canonicalKey: unknown) => {
  const body = String(canonicalKey || '').split(':').slice(1).join(':')
  return body.match(/^(.+)-[0-9]+$/)?.[1] || null
}

const uniqueSources = (sources: any[]) => {
  const seen = new Set<string>()
  return sources.filter(source => {
    const key = String(source?.canonicalKey || `${source?.sourceId || ''}|${source?.sourceName || ''}`)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const compactPreviewRecord = (item: any, family?: any) => ({
  scope: item?.scope,
  canonicalKey: item?.canonicalKey,
  objectType: item?.objectType,
  name: item?.name,
  title: item?.title,
  summary: item?.summary,
  sourceId: item?.sourceId,
  sourceName: item?.sourceName,
  citationReady: true,
  ...(family ? { catalogFamily: family } : {}),
})

const sourceFor = (record: any) => ({
  sourceId: record?.sourceId,
  sourceName: record?.sourceName || 'Kurumsal bilgi kaynağı',
  canonicalKey: record?.canonicalKey,
  objectType: record?.objectType,
  title: record?.title || record?.name,
})

async function exactFallbackPreview(
  client: any,
  workspaceId: string,
  args: Record<string, unknown>,
  discovery: AssistantToolExecution,
): Promise<AssistantToolExecution | null> {
  const query = String(args.query || '').trim()
  if (!query) return null
  const requestedTypes = Array.isArray(args.objectTypes) ? args.objectTypes : null
  if (!requestedTypes?.length) return null

  const exact = await productionExecuteAssistantTool(client, workspaceId, 'get_objects_by_technical_reference', {
    technicalReference: query,
    objectTypes: requestedTypes,
  })
  const exactPayload: any = parse(exact.output)
  const recordContainer = exactPayload?.records
  const exactItems = Array.isArray(recordContainer)
    ? recordContainer
    : Array.isArray(recordContainer?.items)
      ? recordContainer.items
      : []
  if (!exactItems.length) return null

  const totalCount = Number(recordContainer?.totalCount || exact.summary?.totalCount || exactItems.length)
  const familyLike = Boolean(exact.summary?.exactFamilyEnumeration || recordContainer?.totalCount)
  const family = familyLike
    ? {
      prefix: query.toUpperCase(),
      objectType: requestedTypes.length === 1 ? String(requestedTypes[0]) : 'mixed',
      totalCount,
      previewCount: Math.min(8, exactItems.length),
      complete: totalCount <= Math.min(8, exactItems.length),
    }
    : null
  const preview = exactItems.slice(0, 8).map((item: any) => compactPreviewRecord(item, family))
  const previewSources = preview.map(sourceFor)

  return {
    ...discovery,
    output: JSON.stringify({
      securityNotice: 'VERIFIED_KNOWLEDGE_DATA.',
      tool: 'search_knowledge_catalog',
      records: preview,
      catalogFamilies: family ? [family] : [],
      familyPreview: family ? preview : [],
      familyPreviewNotice: family
        ? 'These are verified representative records from a larger exact catalog family. Use them directly for examples. Enumerate the family only if the user requests all/count/exhaustive output.'
        : undefined,
      recoveredFromTypedSearchZeroHit: true,
    }),
    sources: uniqueSources([...(exact.sources || []), ...previewSources]),
    summary: {
      ...(discovery.summary || {}),
      resultCount: preview.length,
      candidateSourceCount: preview.length,
      citationReady: true,
      verifiedPublishedSourceCount: preview.length,
      catalogFamilyCount: family ? 1 : 0,
      catalogFamilyPreviewRecords: family ? preview.length : 0,
      catalogFamilyTotalCount: family ? totalCount : undefined,
      primaryModelObjectTypesRespected: 1,
      recoveredFromTypedSearchZeroHit: 1,
    },
  }
}

async function verifiedTypedSearch(
  client: any,
  workspaceId: string,
  args: Record<string, unknown>,
): Promise<AssistantToolExecution> {
  // Preserve the primary model's explicit objectTypes instead of broadening to
  // the full catalog. Candidates are exact-verified before becoming citation-ready.
  const discovery = await technicalBaseExecuteAssistantTool(client, workspaceId, 'search_knowledge_catalog', args)
  const payload: any = parse(discovery.output)
  const candidates = Array.isArray(payload?.records) ? payload.records : []
  if (!candidates.length) {
    return await exactFallbackPreview(client, workspaceId, args, discovery) || discovery
  }

  const verified: any[] = []
  const sources: any[] = []
  for (const candidate of candidates.slice(0, 8)) {
    const canonicalKey = String(candidate?.canonicalKey || '').trim()
    if (!canonicalKey) continue
    const { data, error } = await client.rpc('get_knowledge_object_v2', {
      p_workspace_id: workspaceId,
      p_canonical_key: canonicalKey,
      p_object_types: null,
    })
    if (error) continue
    const row = Array.isArray(data) ? data[0] : data
    if (!row) continue
    const record = {
      ...candidate,
      canonicalKey: String(row.canonical_key || canonicalKey),
      objectType: String(row.object_type || candidate.objectType || ''),
      name: String(row.object_name || candidate.objectName || candidate.name || ''),
      title: String(row.title || candidate.title || row.object_name || ''),
      summary: String(row.summary || candidate.summary || '').slice(0, 900),
      sourceId: row.source_id ? String(row.source_id) : undefined,
      sourceName: String(row.source_name || candidate.sourceName || 'Kurumsal bilgi kaynağı'),
      citationReady: true,
    }
    verified.push(record)
    sources.push(sourceFor(record))
  }
  if (!verified.length) {
    return await exactFallbackPreview(client, workspaceId, args, discovery) || discovery
  }

  const families: any[] = []
  const familyPreview: any[] = []
  const familyPreviewSources: any[] = []
  const familyKeys = new Map<string, { prefix: string; objectType: string }>()
  for (const record of verified) {
    if (record.objectType !== 'message') continue
    const prefix = familyPrefix(record.canonicalKey)
    if (prefix) familyKeys.set(`message|${prefix.toLowerCase()}`, { prefix, objectType: 'message' })
  }

  for (const familyKey of [...familyKeys.values()].slice(0, 2)) {
    const { data, error } = await client.rpc('list_knowledge_catalog_v2', {
      p_workspace_id: workspaceId,
      p_object_type: familyKey.objectType,
      p_prefix: familyKey.prefix,
      p_cursor: null,
      p_limit: 8,
    })
    if (error || !data || typeof data !== 'object') continue
    const items = Array.isArray((data as any).items) ? (data as any).items : []
    const totalCount = Number((data as any).totalCount || items.length)
    if (totalCount <= 1 || !items.length) continue
    const metadata = {
      prefix: familyKey.prefix,
      objectType: familyKey.objectType,
      totalCount,
      previewCount: items.length,
      complete: items.length >= totalCount,
    }
    families.push(metadata)
    for (const item of items) {
      const preview = compactPreviewRecord(item, metadata)
      familyPreview.push(preview)
      familyPreviewSources.push(sourceFor(preview))
    }
  }

  return {
    ...discovery,
    output: JSON.stringify({
      securityNotice: 'VERIFIED_KNOWLEDGE_DATA.',
      tool: 'search_knowledge_catalog',
      records: verified,
      catalogFamilies: families,
      familyPreview,
      familyPreviewNotice: families.length
        ? 'Verified familyPreview records may be used directly as representative examples. Enumerate the family only if the user requests all/count/exhaustive output.'
        : undefined,
    }),
    sources: uniqueSources([...sources, ...familyPreviewSources]),
    summary: {
      ...(discovery.summary || {}),
      objectTypes: Array.isArray(args.objectTypes) ? args.objectTypes : null,
      citationReady: true,
      verifiedPublishedSourceCount: verified.length,
      catalogFamilyCount: families.length,
      catalogFamilyPreviewRecords: familyPreview.length,
      primaryModelObjectTypesRespected: 1,
    },
  }
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const args = rawArguments && typeof rawArguments === 'object'
    ? rawArguments as Record<string, unknown>
    : {}
  if (toolName === 'search_knowledge_catalog') {
    return verifiedTypedSearch(client, workspaceId, args)
  }
  return productionExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
}
