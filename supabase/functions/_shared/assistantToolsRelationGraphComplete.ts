import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as relationExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRelationFirstQualityV2.ts'
import * as technicalBase from './assistantToolsTechnicalReferenceQuality.ts'

export * from './assistantToolsRelationFirstQualityV2.ts'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const leaf = (canonicalKey: unknown) => {
  const body = String(canonicalKey || '').split(':').slice(1).join(':')
  return (body.split('/').pop() || body).trim().toUpperCase()
}

const uniqueRecords = (records: any[]) => {
  const seen = new Set<string>()
  return records.filter(record => {
    const key = String(record?.canonicalKey || record?.title || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function allowedSpaceIds(client: any, workspaceId: string) {
  const { data: workspace, error: workspaceError } = await client
    .from('workspaces')
    .select('project_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (workspaceError) throw workspaceError

  const [globalResult, projectResult] = await Promise.all([
    client.from('knowledge_spaces').select('id').eq('scope_type', 'global'),
    workspace?.project_id
      ? client.from('knowledge_spaces').select('id').eq('project_id', String(workspace.project_id))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (globalResult.error) throw globalResult.error
  if ((projectResult as any).error) throw (projectResult as any).error
  return [...new Set([...(globalResult.data || []), ...((projectResult as any).data || [])].map((row: any) => String(row.id)))]
}

async function relationOnlyNodes(client: any, workspaceId: string, reference: string) {
  const spaceIds = await allowedSpaceIds(client, workspaceId)
  if (!spaceIds.length) return []
  const { data, error } = await client
    .from('knowledge_relations_v2')
    .select('source_canonical_key,relation_type,target_canonical_key,evidence')
    .eq('active', true)
    .in('knowledge_space_id', spaceIds)
    .limit(2_000)
  if (error) throw error

  const matchingKeys = new Map<string, string[]>()
  for (const relation of data || []) {
    const source = String(relation.source_canonical_key || '')
    const target = String(relation.target_canonical_key || '')
    for (const key of [source, target]) {
      if (!key || leaf(key) !== reference) continue
      const evidence = String(relation.evidence || '').trim()
      const list = matchingKeys.get(key) || []
      if (evidence && !list.includes(evidence)) list.push(evidence)
      matchingKeys.set(key, list)
    }
  }

  return [...matchingKeys.entries()].map(([canonicalKey, evidence]) => ({
    canonicalKey,
    objectType: canonicalKey.split(':')[0] || 'unknown',
    name: reference,
    title: canonicalKey,
    summary: evidence.slice(0, 4).join(' | '),
    relationOnly: true,
    implementationMaterialized: false,
  }))
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const result = await relationExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
  if (toolName !== 'get_objects_by_technical_reference') return result

  const args = rawArguments && typeof rawArguments === 'object'
    ? rawArguments as Record<string, unknown>
    : {}
  const reference = String(args.technicalReference || '').trim().toUpperCase()
  if (!reference) return result

  const payload: any = parse(result.output)
  if (payload?.records && !Array.isArray(payload.records) && Array.isArray(payload.records.items)) {
    return result
  }

  let records = Array.isArray(payload?.records) ? [...payload.records] : []
  let sources = [...(result.sources || [])]

  if (!records.some((record: any) => String(record?.objectType || '') === 'message')) {
    const fallback = await technicalBase.executeAssistantTool(client, workspaceId, 'get_objects_by_technical_reference', {
      technicalReference: reference,
      objectTypes: null,
    })
    const fallbackPayload: any = parse(fallback.output)
    const fallbackRecords = Array.isArray(fallbackPayload?.records) ? fallbackPayload.records : []
    records = uniqueRecords([...records, ...fallbackRecords])
    sources = uniqueRecords([...sources.map((source: any) => ({ ...source, canonicalKey: source.canonicalKey || `${source.sourceId}|${source.sourceName}` })), ...(fallback.sources || []).map((source: any) => ({ ...source, canonicalKey: source.canonicalKey || `${source.sourceId}|${source.sourceName}` }))])
  }

  const relationNodes = await relationOnlyNodes(client, workspaceId, reference)
  records = uniqueRecords([...records, ...relationNodes])

  return {
    ...result,
    output: JSON.stringify({
      securityNotice: 'VERIFIED_KNOWLEDGE_DATA.',
      technicalReference: reference,
      exactReference: true,
      relationBacked: Boolean(result.summary?.relationBacked) || relationNodes.length > 0,
      records,
    }),
    sources: sources.map((source: any) => {
      const next = { ...source }
      if (String(next.canonicalKey || '').includes('|')) delete next.canonicalKey
      return next
    }),
    summary: {
      ...result.summary,
      recordCount: records.length,
      relationBacked: Boolean(result.summary?.relationBacked) || relationNodes.length > 0,
      relationOnlyCandidateCount: relationNodes.length,
      sourceResolutionRequired: relationNodes.length > 0,
    },
  }
}
