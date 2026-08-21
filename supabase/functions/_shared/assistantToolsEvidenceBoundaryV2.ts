import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as graphExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRelationGraphComplete.ts'

export * from './assistantToolsRelationGraphComplete.ts'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
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

const bounded = (
  result: AssistantToolExecution,
  payload: any,
  reason: string,
  records: any[],
): AssistantToolExecution => ({
  ...result,
  output: JSON.stringify({
    securityNotice: 'VERIFIED_KNOWLEDGE_DATA.',
    tool: 'get_abap_source',
    canonicalKey: payload?.canonicalKey || result.summary?.canonicalKey,
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
  const result = await graphExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
  if (toolName !== 'get_abap_source') return result

  const payload: any = parse(result.output)
  const records = recordArray(payload)
  if (!records.length) return bounded(result, payload, 'implementation_object_unavailable', records)
  if (records.some(implementationUnavailable)) return bounded(result, payload, 'implementation_source_unavailable', records)
  return result
}
