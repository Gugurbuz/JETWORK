import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as relationExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRelationFirstQualityV2.ts'

export * from './assistantToolsRelationFirstQualityV2.ts'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const canonicalLeaf = (value: unknown) => {
  const body = String(value || '').split(':').slice(1).join(':')
  return (body.split('/').pop() || body).trim().toUpperCase()
}

const recordArray = (payload: any): any[] => {
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.records?.items)) return payload.records.items
  return []
}

const implementationUnavailable = (record: any) => {
  const text = `${String(record?.summary || '')}\n${String(record?.content || '')}`
  return /Implementasyon\s+kayna[gğ][ıi]\s*:\s*\**Kaynak\s+bekleniyor\**/iu.test(text)
    || /Function\s+Group\s*:\s*\**Kaynak\s+bekleniyor\**/iu.test(text)
}

const metadataRecord = (record: any) => ({
  canonicalKey: record?.canonicalKey,
  objectType: record?.objectType,
  name: record?.name,
  title: record?.title,
  summary: record?.summary,
  scope: record?.scope,
  sourceId: record?.sourceId,
  sourceName: record?.sourceName,
})

const withBoundary = (
  result: AssistantToolExecution,
  payload: any,
  reason: string,
  records: any[],
): AssistantToolExecution => ({
  ...result,
  output: JSON.stringify({
    securityNotice: 'VERIFIED_KNOWLEDGE_DATA.',
    tool: payload?.tool,
    technicalReference: payload?.technicalReference,
    canonicalKey: payload?.canonicalKey,
    exactReference: payload?.exactReference,
    implementationAvailable: false,
    evidenceBoundary: 'metadata_only',
    evidenceBoundaryReason: reason,
    records: records.map(metadataRecord),
  }),
  summary: {
    ...result.summary,
    implementationAvailable: false,
    evidenceBoundary: 'metadata_only',
    evidenceBoundaryReason: reason,
  },
})

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const result = await relationExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
  const payload: any = parse(result.output)
  const records = recordArray(payload)

  if (toolName === 'get_abap_source' && records.length && records.some(implementationUnavailable)) {
    return withBoundary(result, { ...payload, tool: toolName }, 'implementation_source_unavailable', records)
  }

  if (toolName === 'get_objects_by_technical_reference') {
    const args = rawArguments && typeof rawArguments === 'object'
      ? rawArguments as Record<string, unknown>
      : {}
    const reference = String(args.technicalReference || payload?.technicalReference || '').trim().toUpperCase()
    if (reference && records.length) {
      const exactObjectFound = records.some(record =>
        String(record?.name || '').trim().toUpperCase() === reference
        || canonicalLeaf(record?.canonicalKey) === reference
      )
      if (!exactObjectFound) {
        return withBoundary(
          result,
          { ...payload, tool: toolName, technicalReference: reference },
          'exact_implementation_object_unavailable',
          records,
        )
      }
    }
  }

  return result
}
