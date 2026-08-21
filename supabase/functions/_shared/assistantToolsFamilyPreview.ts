import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsEvidenceBoundaryV2.ts'

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

const itemToRecord = (item: any) => ({
  scope: item?.scope,
  canonicalKey: item?.canonicalKey,
  objectType: item?.objectType,
  name: item?.name,
  title: item?.title,
  summary: item?.summary,
  sourceId: item?.sourceId,
  sourceName: item?.sourceName,
  citationReady: true,
})

async function enrichMessageFamilies(
  client: any,
  workspaceId: string,
  result: AssistantToolExecution,
): Promise<AssistantToolExecution> {
  const payload: any = parse(result.output)
  const records = Array.isArray(payload?.records) ? payload.records : []
  if (!records.length) return result

  const familyKeys = new Map<string, { prefix: string; objectType: string }>()
  for (const record of records) {
    if (String(record?.objectType || '') !== 'message') continue
    const prefix = familyPrefix(record?.canonicalKey)
    if (!prefix) continue
    familyKeys.set(`message|${prefix.toLowerCase()}`, { prefix, objectType: 'message' })
  }
  if (!familyKeys.size) return result

  const previews: any[] = []
  const previewSources: any[] = []
  const familyMeta: any[] = []

  for (const family of [...familyKeys.values()].slice(0, 3)) {
    const { data, error } = await client.rpc('list_knowledge_catalog_v2', {
      p_workspace_id: workspaceId,
      p_object_type: family.objectType,
      p_prefix: family.prefix,
      p_cursor: null,
      p_limit: 8,
    })
    if (error || !data || typeof data !== 'object') continue
    const items = Array.isArray((data as any).items) ? (data as any).items : []
    const totalCount = Math.max(0, Number((data as any).totalCount || items.length))
    if (totalCount <= 1 || !items.length) continue

    const preview = items.map(itemToRecord)
    previews.push(...preview)
    familyMeta.push({
      prefix: family.prefix,
      objectType: family.objectType,
      totalCount,
      previewCount: preview.length,
      complete: preview.length >= totalCount,
    })
    for (const item of preview) {
      previewSources.push({
        sourceId: item.sourceId,
        sourceName: item.sourceName || 'Kurumsal bilgi kaynağı',
        canonicalKey: item.canonicalKey,
        objectType: item.objectType,
        title: item.title || item.name,
      })
    }
  }

  if (!familyMeta.length) return result

  const enrichedRecords = records.map((record: any) => {
    if (String(record?.objectType || '') !== 'message') return record
    const prefix = familyPrefix(record?.canonicalKey)
    if (!prefix) return record
    const family = familyMeta.find(meta => meta.prefix.toLowerCase() === prefix.toLowerCase())
    return family ? { ...record, catalogFamily: family } : record
  })

  return {
    ...result,
    output: JSON.stringify({
      securityNotice: 'VERIFIED_KNOWLEDGE_DATA.',
      tool: 'search_knowledge_catalog',
      records: enrichedRecords,
      catalogFamilies: familyMeta,
      familyPreview: previews,
      familyPreviewNotice: 'familyPreview contains verified message titles from the same published catalog family and may be used directly for representative examples. Use list_knowledge_catalog only when an exhaustive family result is needed.',
    }),
    sources: uniqueSources([...(result.sources || []), ...previewSources]),
    summary: {
      ...(result.summary || {}),
      catalogFamilyCount: familyMeta.length,
      catalogFamilyPreviewRecords: previews.length,
      catalogFamilyPreviewVerified: true,
    },
  }
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const result = await baseExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
  if (toolName !== 'search_knowledge_catalog') return result
  return enrichMessageFamilies(client, workspaceId, result)
}
