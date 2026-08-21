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

async function verifiedTypedSearch(
  client: any,
  workspaceId: string,
  args: Record<string, unknown>,
): Promise<AssistantToolExecution> {
  // The lower-level search implementation honors objectTypes. The production
  // relation wrapper currently replaces them with null; this adapter preserves
  // the primary model's explicit tool choice and then exact-verifies candidates.
  const discovery = await technicalBaseExecuteAssistantTool(client, workspaceId, 'search_knowledge_catalog', args)
  const payload: any = parse(discovery.output)
  const candidates = Array.isArray(payload?.records) ? payload.records : []
  if (!candidates.length) return discovery

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
    sources.push({
      sourceId: record.sourceId,
      sourceName: record.sourceName,
      canonicalKey: record.canonicalKey,
      objectType: record.objectType,
      title: record.title,
    })
  }
  if (!verified.length) return discovery

  const families: any[] = []
  const familyPreview: any[] = []
  const familyPreviewSources: any[] = []
  const familyKeys = new Map<string, { prefix: string; objectType: string }>()
  for (const record of verified) {
    if (record.objectType !== 'message') continue
    const prefix = familyPrefix(record.canonicalKey)
    if (prefix) familyKeys.set(`message|${prefix.toLowerCase()}`, { prefix, objectType: 'message' })
  }

  for (const family of [...familyKeys.values()].slice(0, 2)) {
    const { data, error } = await client.rpc('list_knowledge_catalog_v2', {
      p_workspace_id: workspaceId,
      p_object_type: family.objectType,
      p_prefix: family.prefix,
      p_cursor: null,
      p_limit: 8,
    })
    if (error || !data || typeof data !== 'object') continue
    const items = Array.isArray((data as any).items) ? (data as any).items : []
    const totalCount = Number((data as any).totalCount || items.length)
    if (totalCount <= 1 || !items.length) continue
    const metadata = {
      prefix: family.prefix,
      objectType: family.objectType,
      totalCount,
      previewCount: items.length,
      complete: items.length >= totalCount,
    }
    families.push(metadata)
    for (const item of items) {
      const preview = {
        scope: item?.scope,
        canonicalKey: item?.canonicalKey,
        objectType: item?.objectType,
        name: item?.name,
        title: item?.title,
        summary: item?.summary,
        sourceId: item?.sourceId,
        sourceName: item?.sourceName,
        citationReady: true,
        catalogFamily: metadata,
      }
      familyPreview.push(preview)
      familyPreviewSources.push({
        sourceId: preview.sourceId,
        sourceName: preview.sourceName || 'Kurumsal bilgi kaynağı',
        canonicalKey: preview.canonicalKey,
        objectType: preview.objectType,
        title: preview.title || preview.name,
      })
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
