import {
  ASSISTANT_KNOWLEDGE_TOOLS as BASE_ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as productionExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsEvidenceBoundaryV2.ts'
import { executeAssistantTool as technicalBaseExecuteAssistantTool } from './assistantToolsTechnicalReferenceQuality.ts'

export * from './assistantToolsEvidenceBoundaryV2.ts'

const SEARCH_TOOL_DESCRIPTION = 'Search the published structured knowledge catalog. Choose resultMode="preview" when the user wants examples, representative records, or a bounded answer. Choose resultMode="complete" when the user asks an unbounded inventory question whose natural answer is the full matching set, asks for all/every/complete/count/exhaustive results, or otherwise requires completeness. This mode is the primary model\'s semantic cardinality decision: the executor must not infer it from keywords. Search remains discovery; a complete family may still require list_knowledge_catalog.'
const LIST_TOOL_DESCRIPTION = 'Enumerate published knowledge objects by object type and/or name/canonical prefix. Choose responseMode="preview" when the user wants examples, some representative records, or a bounded selection. Choose responseMode="complete" when the user asks for all/every/complete/count/exhaustive results or when an unbounded inventory answer must be complete. Preview mode returns one bounded page; complete mode aggregates the authoritative family within the safe tool budget.'

export const ASSISTANT_KNOWLEDGE_TOOLS = BASE_ASSISTANT_KNOWLEDGE_TOOLS.map((tool: any) => {
  const name = String(tool?.name || '')
  if (name === 'search_knowledge_catalog') {
    return {
      ...tool,
      description: SEARCH_TOOL_DESCRIPTION,
      parameters: {
        ...tool.parameters,
        properties: {
          ...(tool.parameters?.properties || {}),
          resultMode: { type: 'string', enum: ['preview', 'complete'] },
        },
        required: [...new Set([...(tool.parameters?.required || []), 'resultMode'])],
        additionalProperties: false,
      },
    }
  }
  if (name === 'list_knowledge_catalog') {
    return {
      ...tool,
      description: LIST_TOOL_DESCRIPTION,
      parameters: {
        ...tool.parameters,
        properties: {
          ...(tool.parameters?.properties || {}),
          responseMode: { type: 'string', enum: ['preview', 'complete'] },
        },
        required: [...new Set([...(tool.parameters?.required || []), 'responseMode'])],
        additionalProperties: false,
      },
    }
  }
  return tool
}) as typeof BASE_ASSISTANT_KNOWLEDGE_TOOLS

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
  resultMode: 'preview' | 'complete',
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
      resultMode,
      records: preview,
      catalogFamilies: family ? [family] : [],
      familyPreview: family ? preview : [],
      familyPreviewNotice: family
        ? resultMode === 'complete'
          ? 'Verified family preview found for a larger catalog family. The primary model requested complete cardinality; continue with list_knowledge_catalog to enumerate the authoritative family.'
          : 'Verified representative records from a larger catalog family. The primary model requested preview cardinality; these records may be used directly without exhaustive enumeration.'
        : undefined,
      recoveredFromTypedSearchZeroHit: true,
    }),
    sources: uniqueSources([...(exact.sources || []), ...previewSources]),
    summary: {
      ...(discovery.summary || {}),
      resultMode,
      resultCount: preview.length,
      candidateSourceCount: preview.length,
      citationReady: true,
      verifiedPublishedSourceCount: preview.length,
      catalogFamilyCount: family ? 1 : 0,
      catalogFamilyPreviewRecords: family ? preview.length : 0,
      catalogFamilyTotalCount: family ? totalCount : undefined,
      primaryModelObjectTypesRespected: 1,
      primaryModelSearchCardinalityRespected: 1,
      recoveredFromTypedSearchZeroHit: 1,
    },
  }
}

async function verifiedTypedSearch(
  client: any,
  workspaceId: string,
  rawArgs: Record<string, unknown>,
): Promise<AssistantToolExecution> {
  const resultMode = String(rawArgs.resultMode || 'preview') === 'complete' ? 'complete' : 'preview'
  const args = { ...rawArgs }
  delete args.resultMode
  const discovery = await technicalBaseExecuteAssistantTool(client, workspaceId, 'search_knowledge_catalog', args)
  const payload: any = parse(discovery.output)
  const candidates = Array.isArray(payload?.records) ? payload.records : []
  if (!candidates.length) {
    return await exactFallbackPreview(client, workspaceId, args, discovery, resultMode) || {
      ...discovery,
      summary: { ...(discovery.summary || {}), resultMode, primaryModelSearchCardinalityRespected: 1 },
    }
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
    return await exactFallbackPreview(client, workspaceId, args, discovery, resultMode) || {
      ...discovery,
      summary: { ...(discovery.summary || {}), resultMode, primaryModelSearchCardinalityRespected: 1 },
    }
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
      resultMode,
      records: verified,
      catalogFamilies: families,
      familyPreview,
      familyPreviewNotice: families.length
        ? resultMode === 'complete'
          ? 'The primary model requested complete cardinality. Use list_knowledge_catalog if the family is larger than the verified preview.'
          : 'The primary model requested preview cardinality. Verified familyPreview records may be used directly without exhaustive enumeration.'
        : undefined,
    }),
    sources: uniqueSources([...sources, ...familyPreviewSources]),
    summary: {
      ...(discovery.summary || {}),
      resultMode,
      objectTypes: Array.isArray(args.objectTypes) ? args.objectTypes : null,
      citationReady: true,
      verifiedPublishedSourceCount: verified.length,
      catalogFamilyCount: families.length,
      catalogFamilyPreviewRecords: familyPreview.length,
      primaryModelObjectTypesRespected: 1,
      primaryModelSearchCardinalityRespected: 1,
    },
  }
}

async function executeCatalogList(
  client: any,
  workspaceId: string,
  args: Record<string, unknown>,
): Promise<AssistantToolExecution> {
  const responseMode = String(args.responseMode || 'complete') === 'preview' ? 'preview' : 'complete'
  const forwarded = { ...args }
  delete forwarded.responseMode

  if (responseMode === 'preview') {
    const result = await technicalBaseExecuteAssistantTool(client, workspaceId, 'list_knowledge_catalog', forwarded)
    return {
      ...result,
      summary: {
        ...(result.summary || {}),
        responseMode: 'preview',
        primaryModelCardinalityRespected: 1,
      },
    }
  }

  const result = await productionExecuteAssistantTool(client, workspaceId, 'list_knowledge_catalog', forwarded)
  return {
    ...result,
    summary: {
      ...(result.summary || {}),
      responseMode: 'complete',
      primaryModelCardinalityRespected: 1,
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
  if (toolName === 'search_knowledge_catalog') return verifiedTypedSearch(client, workspaceId, args)
  if (toolName === 'list_knowledge_catalog') return executeCatalogList(client, workspaceId, args)
  return productionExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
}
