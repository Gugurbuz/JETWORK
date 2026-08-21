import * as base from './assistantToolsTechnicalReferenceQuality.ts'
export * from './assistantToolsTechnicalReferenceQuality.ts'

const TARGET_TYPES = [
  'class','method','function','message','table','document','business_rule','interface',
  'system','component','service','api','database','queue','job','screen','decision','requirement','unknown',
]

const parse = (value: unknown) => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null } }
const unique = <T extends Record<string, any>>(rows: T[]) => {
  const seen = new Set<string>()
  return rows.filter(row => {
    const key = String(row.canonicalKey || row.canonical_key || row.title || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
const canonicalName = (key: string) => {
  const body = String(key || '').split(':').slice(1).join(':')
  return (body.split('/').pop() || body).toUpperCase()
}
const familyPrefix = (key: string) => {
  const body = String(key || '').includes(':') ? String(key).split(':').slice(1).join(':') : String(key || '')
  return body.match(/^(.+)-[0-9]+$/)?.[1] || null
}

const rewriteTool = (tool: any) => {
  if (tool?.name === 'get_objects_by_technical_reference') return {
    ...tool,
    description: 'Resolve a named technical identifier using exact object identity and authoritative knowledge relations first. objectTypes are only a preference and cannot hide exact relations; similarly named identifiers are not merged. If no exact relation exists and the identifier is a catalog family, return the complete family.',
  }
  if (tool?.name === 'search_knowledge_catalog') return {
    ...tool,
    description: 'Broad discovery across current published knowledge. Results are citation-ready and may include catalogFamily metadata with totalCount. When the user asks for the matching family/list/all records, use list_knowledge_catalog with that family prefix. Prefer get_objects_by_technical_reference when a precise identifier is known.',
  }
  if (tool?.name === 'list_knowledge_catalog') return {
    ...tool,
    description: 'Enumerate published objects by object type/prefix. With cursor=null runtime aggregates pages up to 100 and returns complete=true when exhaustive.',
  }
  if (tool?.name === 'get_document_content') return {
    ...tool,
    description: 'Retrieve full published document content. For process/how-to questions use the complete relevant sequence through completion/save.',
  }
  return tool
}

export const ASSISTANT_KNOWLEDGE_TOOLS = (base.ASSISTANT_KNOWLEDGE_TOOLS as any[]).map(rewriteTool) as any

async function spaces(client: any, workspaceId: string) {
  const { data: workspace, error: workspaceError } = await client.from('workspaces').select('project_id').eq('id', workspaceId).maybeSingle()
  if (workspaceError) throw workspaceError
  const [globalResult, projectResult] = await Promise.all([
    client.from('knowledge_spaces').select('id,scope_type').eq('scope_type', 'global'),
    workspace?.project_id
      ? client.from('knowledge_spaces').select('id,scope_type').eq('project_id', String(workspace.project_id))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (globalResult.error) throw globalResult.error
  if ((projectResult as any).error) throw (projectResult as any).error
  const all = [...(globalResult.data || []), ...((projectResult as any).data || [])]
  return {
    ids: [...new Set(all.map((row: any) => String(row.id)))],
    byId: new Map(all.map((row: any) => [String(row.id), row])),
  }
}

async function decorate(client: any, objects: any[], spacesById: Map<string, any>) {
  const versionIds = [...new Set(objects.map(row => String(row.published_version_id || '')).filter(Boolean))]
  const sourceIds = [...new Set(objects.map(row => String(row.primary_source_id || '')).filter(Boolean))]
  const [versionResult, sourceResult] = await Promise.all([
    versionIds.length
      ? client.from('knowledge_object_versions_v2').select('id,title,summary,content').in('id', versionIds)
      : Promise.resolve({ data: [], error: null }),
    sourceIds.length
      ? client.from('knowledge_sources_v2').select('id,name').in('id', sourceIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if ((versionResult as any).error) throw (versionResult as any).error
  if ((sourceResult as any).error) throw (sourceResult as any).error
  const versions = new Map(((versionResult as any).data || []).map((row: any) => [String(row.id), row]))
  const sources = new Map(((sourceResult as any).data || []).map((row: any) => [String(row.id), String(row.name || 'Kurumsal bilgi kaynağı')]))
  const records = objects.map((row: any) => {
    const version: any = versions.get(String(row.published_version_id || '')) || {}
    const canonicalKey = String(row.canonical_key || '')
    return {
      canonicalKey,
      objectType: String(row.object_type || canonicalKey.split(':')[0] || 'unknown'),
      name: String(row.name || canonicalName(canonicalKey)),
      title: String(version.title || row.name || canonicalName(canonicalKey)).slice(0, 600),
      summary: String(version.summary || '').slice(0, 1_600),
      content: String(version.content || '').slice(0, 8_000),
      scope: spacesById.get(String(row.knowledge_space_id))?.scope_type === 'project' ? 'project' : 'global',
      sourceId: row.primary_source_id ? String(row.primary_source_id) : undefined,
      sourceName: sources.get(String(row.primary_source_id || '')) || 'Kurumsal bilgi kaynağı',
    }
  })
  return {
    records,
    sources: records.map((record: any) => ({
      sourceId: record.sourceId,
      sourceName: record.sourceName,
      canonicalKey: record.canonicalKey,
      objectType: record.objectType,
      title: record.title,
    })),
  }
}

async function objectsForKeys(client: any, canonicalKeys: string[], spaceIds: string[]) {
  if (!canonicalKeys.length) return []
  const { data, error } = await client.from('knowledge_objects_v2')
    .select('id,knowledge_space_id,canonical_key,object_type,name,published_version_id,primary_source_id')
    .in('canonical_key', [...new Set(canonicalKeys)])
    .eq('publication_status', 'published')
    .in('knowledge_space_id', spaceIds)
  if (error) throw error
  return data || []
}

async function familyMetadata(client: any, workspaceId: string, records: any[]) {
  const families = new Map<string, { prefix: string; objectType: string; totalCount: number }>()
  for (const record of records) {
    const prefix = familyPrefix(String(record.canonicalKey || ''))
    const objectType = String(record.objectType || '')
    if (!prefix || !objectType) continue
    const key = `${objectType}|${prefix.toLowerCase()}`
    if (families.has(key)) continue
    const { data, error } = await client.rpc('list_knowledge_catalog_v2', {
      p_workspace_id: workspaceId,
      p_object_type: objectType,
      p_prefix: prefix,
      p_cursor: null,
      p_limit: 1,
    })
    if (error) continue
    const totalCount = Number((data as any)?.totalCount || 0)
    if (totalCount > 1) families.set(key, { prefix, objectType, totalCount })
  }
  return families
}

async function enrichSearch(client: any, workspaceId: string, result: any) {
  const payload: any = parse(result.output)
  const records = Array.isArray(payload?.records) ? payload.records : []
  if (!records.length) return result
  const families = await familyMetadata(client, workspaceId, records)
  const enriched: any[] = []
  const sourceRefs: any[] = []
  for (const record of records) {
    const canonicalKey = String(record.canonicalKey || '').trim()
    let nextRecord = { ...record }
    if (canonicalKey) {
      const { data } = await client.rpc('get_knowledge_object_v2', {
        p_workspace_id: workspaceId,
        p_canonical_key: canonicalKey,
        p_object_types: null,
      })
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        const objectType = String(row.object_type || record.objectType || '')
        const prefix = familyPrefix(String(row.canonical_key || canonicalKey))
        const family = prefix ? families.get(`${objectType}|${prefix.toLowerCase()}`) : null
        nextRecord = {
          ...record,
          sourceId: row.source_id ? String(row.source_id) : undefined,
          sourceName: String(row.source_name || record.sourceName || 'Kurumsal bilgi kaynağı'),
          canonicalKey: String(row.canonical_key || canonicalKey),
          objectType,
          title: String(row.title || row.object_name || record.title || ''),
          citationReady: true,
          ...(family ? { catalogFamily: family } : {}),
        }
        sourceRefs.push({
          sourceId: nextRecord.sourceId,
          sourceName: nextRecord.sourceName,
          canonicalKey: nextRecord.canonicalKey,
          objectType: nextRecord.objectType,
          title: nextRecord.title,
        })
      }
    }
    enriched.push(nextRecord)
  }
  return {
    ...result,
    output: JSON.stringify({ securityNotice: 'VERIFIED_KNOWLEDGE_DATA.', tool: 'search_knowledge_catalog', records: enriched }),
    sources: unique(sourceRefs),
    summary: {
      ...result.summary,
      citationReady: sourceRefs.length > 0,
      verifiedPublishedSourceCount: sourceRefs.length,
      catalogFamilyCount: families.size,
    },
  }
}

async function familyLookup(client: any, ref: string, requestedTypes: string[] | null, spaceInfo: any) {
  const wantedTypes = [...new Set([...(requestedTypes?.length ? requestedTypes : []), 'message'])]
  let objects: any[] = []
  let totalCount = 0
  for (const objectType of wantedTypes) {
    const pattern = `${objectType}:${ref.toLowerCase().replace(/[%_]/g, '\\$&')}-%`
    const { data, error, count } = await client.from('knowledge_objects_v2')
      .select('id,knowledge_space_id,canonical_key,object_type,name,published_version_id,primary_source_id', { count: 'exact' })
      .eq('publication_status', 'published')
      .in('knowledge_space_id', spaceInfo.ids)
      .ilike('canonical_key', pattern)
      .order('canonical_key')
      .limit(100)
    if (error) throw error
    if (data?.length) {
      objects.push(...data)
      totalCount += Number(count || data.length)
    }
  }
  objects = unique(objects.map(row => ({ ...row, canonicalKey: row.canonical_key }))).map((row: any) => {
    delete row.canonicalKey
    return row
  })
  if (!objects.length) return null
  const decorated = await decorate(client, objects, spaceInfo.byId)
  return {
    output: JSON.stringify({
      tool: 'list_knowledge_catalog',
      technicalReference: ref,
      records: {
        items: decorated.records,
        totalCount,
        returnedCount: decorated.records.length,
        nextCursor: null,
        complete: decorated.records.length === totalCount,
      },
    }),
    sources: decorated.sources,
    summary: {
      recordCount: decorated.records.length,
      totalCount,
      complete: decorated.records.length === totalCount,
      citationReady: true,
      exactFamilyEnumeration: true,
    },
  }
}

async function exactTechnicalReference(client: any, workspaceId: string, rawReference: unknown, requestedObjectTypes: unknown) {
  const reference = String(rawReference || '').trim().toUpperCase().slice(0, 160)
  const requestedTypes = Array.isArray(requestedObjectTypes)
    ? [...new Set(requestedObjectTypes.map(String).filter(value => TARGET_TYPES.includes(value)))]
    : null
  if (!reference) return null
  const spaceInfo = await spaces(client, workspaceId)
  const { data: exactRows, error: objectError } = await client.from('knowledge_objects_v2')
    .select('id,knowledge_space_id,canonical_key,object_type,name,published_version_id,primary_source_id')
    .eq('publication_status', 'published')
    .in('knowledge_space_id', spaceInfo.ids)
    .ilike('name', reference)
    .limit(30)
  if (objectError) throw objectError
  const exactObjects = (exactRows || []).filter((row: any) => String(row.name || '').toUpperCase() === reference)
  const exactKeys = [...new Set(exactObjects.map((row: any) => String(row.canonical_key)))]
  const { data: relationRows, error: relationError } = await client.from('knowledge_relations_v2')
    .select('source_canonical_key,relation_type,target_canonical_key')
    .eq('active', true)
    .in('knowledge_space_id', spaceInfo.ids)
    .limit(2_000)
  if (relationError) throw relationError
  const canonicalMatches = (key: unknown) => {
    const body = String(key || '').split(':').slice(1).join(':')
    const last = body.split('/').pop() || body
    return last.toUpperCase() === reference
  }
  const matchedRelations = (relationRows || []).filter((row: any) =>
    exactKeys.includes(String(row.source_canonical_key)) ||
    exactKeys.includes(String(row.target_canonical_key)) ||
    canonicalMatches(row.source_canonical_key) ||
    canonicalMatches(row.target_canonical_key)
  )
  const relatedKeys: string[] = []
  for (const relation of matchedRelations) {
    const sourceKey = String(relation.source_canonical_key || '')
    const targetKey = String(relation.target_canonical_key || '')
    const sourceMatch = exactKeys.includes(sourceKey) || canonicalMatches(sourceKey)
    const targetMatch = exactKeys.includes(targetKey) || canonicalMatches(targetKey)
    if (sourceMatch && !targetMatch && targetKey) relatedKeys.push(targetKey)
    if (targetMatch && !sourceMatch && sourceKey) relatedKeys.push(sourceKey)
  }
  const relatedObjects = await objectsForKeys(client, [...new Set(relatedKeys)], spaceInfo.ids)
  let relationEvidence: any = null
  if (relatedObjects.length) {
    const chosen = unique([...relatedObjects, ...exactObjects].map(row => ({ ...row, canonicalKey: row.canonical_key }))).map((row: any) => {
      delete row.canonicalKey
      return row
    })
    relationEvidence = await decorate(client, chosen, spaceInfo.byId)
    if (relationEvidence.records.some((record: any) => record.objectType === 'message')) {
      return {
        output: JSON.stringify({ technicalReference: reference, exactReference: true, relationBacked: true, records: relationEvidence.records }),
        sources: relationEvidence.sources,
        summary: {
          recordCount: relationEvidence.records.length,
          citationReady: true,
          relationBacked: true,
          relationCount: matchedRelations.length,
        },
      }
    }
  }
  const fallback = await base.executeAssistantTool(client, workspaceId, 'get_objects_by_technical_reference', {
    technicalReference: reference,
    objectTypes: requestedTypes,
  })
  const fallbackPayload: any = parse(fallback.output)
  const fallbackRecords = Array.isArray(fallbackPayload?.records) ? fallbackPayload.records : []
  if (fallbackRecords.length) {
    if (relationEvidence?.records?.length) {
      const combined = unique([...relationEvidence.records, ...fallbackRecords])
      return {
        output: JSON.stringify({ technicalReference: reference, exactReference: true, relationBacked: matchedRelations.length > 0, records: combined }),
        sources: unique([...(relationEvidence.sources || []), ...(fallback.sources || [])]),
        summary: {
          recordCount: combined.length,
          citationReady: true,
          relationBacked: matchedRelations.length > 0,
          relationCount: matchedRelations.length,
        },
      }
    }
    return fallback
  }
  if (relationEvidence?.records?.length) {
    return {
      output: JSON.stringify({ technicalReference: reference, exactReference: true, relationBacked: true, records: relationEvidence.records }),
      sources: relationEvidence.sources,
      summary: {
        recordCount: relationEvidence.records.length,
        citationReady: true,
        relationBacked: true,
        relationCount: matchedRelations.length,
      },
    }
  }
  return familyLookup(client, reference, requestedTypes, spaceInfo)
}

async function aggregateCatalog(client: any, workspaceId: string, args: any, first: any) {
  if (args?.cursor) return first
  const payload: any = parse(first.output)?.records
  let items = Array.isArray(payload?.items) ? [...payload.items] : []
  let sources = [...(first.sources || [])]
  let nextCursor = payload?.nextCursor || null
  const totalCount = Number(payload?.totalCount || first.summary?.totalCount || items.length)
  let pages = 1
  while (nextCursor && items.length < 100 && pages < 8) {
    const next = await base.executeAssistantTool(client, workspaceId, 'list_knowledge_catalog', { ...args, cursor: nextCursor, limit: 25 })
    const nextPayload: any = parse(next.output)?.records
    const nextItems = Array.isArray(nextPayload?.items) ? nextPayload.items : []
    items.push(...nextItems)
    sources.push(...(next.sources || []))
    nextCursor = nextPayload?.nextCursor || null
    pages += 1
    if (!nextItems.length) break
  }
  items = items.slice(0, 100)
  const truncated = Boolean(nextCursor) || totalCount > items.length
  return {
    output: JSON.stringify({ tool: 'list_knowledge_catalog', records: { items, totalCount, returnedCount: items.length, nextCursor: truncated ? nextCursor : null, complete: !truncated } }),
    sources: unique(sources),
    summary: { ...first.summary, resultCount: items.length, totalCount, returnedCount: items.length, complete: !truncated, aggregatedPages: pages, citationReady: true },
  }
}

export async function executeAssistantTool(client: any, workspaceId: string, toolName: string, rawArguments: unknown): Promise<any> {
  const args = rawArguments && typeof rawArguments === 'object' ? rawArguments as any : {}
  if (toolName === 'get_objects_by_technical_reference') {
    const exact = await exactTechnicalReference(client, workspaceId, args.technicalReference, args.objectTypes)
    if (exact) return exact
  }
  if (toolName === 'search_knowledge_catalog') {
    const result = await base.executeAssistantTool(client, workspaceId, toolName, { ...args, objectTypes: null, limit: 8 })
    return enrichSearch(client, workspaceId, result)
  }
  const result = await base.executeAssistantTool(client, workspaceId, toolName, args)
  if (toolName === 'list_knowledge_catalog') return aggregateCatalog(client, workspaceId, args, result)
  return result
}
