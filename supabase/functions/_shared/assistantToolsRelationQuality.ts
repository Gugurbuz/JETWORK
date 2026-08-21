import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/3c15bf2ba35274683d2c3f61e1880d61c9e9fd45/supabase/functions/_shared/assistantTools.ts?technical-reference-quality-base=3'
import { contentReferencesTechnicalReference } from './technicalRelationRoutingQuality.ts'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/3c15bf2ba35274683d2c3f61e1880d61c9e9fd45/supabase/functions/_shared/assistantTools.ts?technical-reference-quality-base=3'

const TARGET_OBJECT_TYPES = ['class','method','function','message','table','document','business_rule','interface','system','component','service','api','database','queue','job','screen','decision','requirement','unknown'] as const

const TECHNICAL_REFERENCE_OBJECTS_TOOL = {
  type: 'function',
  name: 'get_objects_by_technical_reference',
  description: 'Get citation-ready published knowledge objects whose authoritative content explicitly references one technical identifier. Use for relation questions such as which messages, tables, functions, classes, or methods are connected to an identifier. This capability is generic and must not depend on a specific identifier name or prefix.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      technicalReference: { type: 'string', minLength: 3, maxLength: 160 },
      objectTypes: {
        type: ['array', 'null'],
        items: { type: 'string', enum: TARGET_OBJECT_TYPES },
      },
    },
    required: ['technicalReference', 'objectTypes'],
    additionalProperties: false,
  },
} as const

export const ASSISTANT_KNOWLEDGE_TOOLS = [...original.ASSISTANT_KNOWLEDGE_TOOLS, TECHNICAL_REFERENCE_OBJECTS_TOOL] as const

const cleanReference = (value: unknown) => String(value || '').trim().toLocaleUpperCase('en-US').slice(0, 160)
const safeText = (value: unknown, max = 8_000) => String(value || '').slice(0, max)

async function getObjectsByTechnicalReference(client: any, workspaceId: string, technicalReference: string, requestedTypes: unknown): Promise<original.AssistantToolExecution> {
  const ref = cleanReference(technicalReference)
  if (!ref) throw new Error('technicalReference is required.')
  const objectTypes = Array.isArray(requestedTypes)
    ? [...new Set(requestedTypes.map(value => String(value || '').trim()).filter(value => (TARGET_OBJECT_TYPES as readonly string[]).includes(value)))]
    : null

  const { data: workspace, error: workspaceError } = await client.from('workspaces').select('project_id').eq('id', workspaceId).maybeSingle()
  if (workspaceError) throw workspaceError

  const [globalSpacesResult, projectSpacesResult] = await Promise.all([
    client.from('knowledge_spaces').select('id,scope_type,project_id').eq('scope_type', 'global'),
    workspace?.project_id
      ? client.from('knowledge_spaces').select('id,scope_type,project_id').eq('project_id', String(workspace.project_id))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (globalSpacesResult.error) throw globalSpacesResult.error
  if (projectSpacesResult.error) throw projectSpacesResult.error

  const spaces = [...(globalSpacesResult.data || []), ...(projectSpacesResult.data || [])]
  const spaceById = new Map(spaces.map((space: Record<string, unknown>) => [String(space.id), space]))
  const spaceIds = [...spaceById.keys()]
  if (!spaceIds.length) return { output: JSON.stringify({ technicalReference: ref, records: [] }), sources: [], summary: { technicalReference: ref, recordCount: 0, citationReady: true } }

  const { data: versions, error: versionError } = await client
    .from('knowledge_object_versions_v2')
    .select('id,object_id,title,summary,content,metadata')
    .eq('is_current', true)
    .or(`summary.ilike.%${ref}%,content.ilike.%${ref}%`)
    .limit(120)
  if (versionError) throw versionError

  const candidateVersions = (versions || []).filter((version: Record<string, unknown>) => contentReferencesTechnicalReference(`${String(version.summary || '')}\n${String(version.content || '')}`, ref))
  const objectIds = [...new Set(candidateVersions.map((version: Record<string, unknown>) => String(version.object_id || '')).filter(Boolean))]
  if (!objectIds.length) return { output: JSON.stringify({ technicalReference: ref, records: [] }), sources: [], summary: { technicalReference: ref, recordCount: 0, citationReady: true } }

  let objectsQuery = client.from('knowledge_objects_v2')
    .select('id,knowledge_space_id,canonical_key,object_type,name,publication_status,published_version_id,primary_source_id')
    .in('id', objectIds)
    .eq('publication_status', 'published')
    .in('knowledge_space_id', spaceIds)
  if (objectTypes?.length) objectsQuery = objectsQuery.in('object_type', objectTypes)
  const { data: objects, error: objectError } = await objectsQuery
  if (objectError) throw objectError

  const versionByObjectId = new Map(candidateVersions.map((version: Record<string, unknown>) => [String(version.object_id), version]))
  const eligible = (objects || []).filter((object: Record<string, unknown>) => {
    const version = versionByObjectId.get(String(object.id)) as Record<string, unknown> | undefined
    return version && String(object.published_version_id || '') === String(version.id || '')
  })

  const sourceIds = [...new Set(eligible.map((object: Record<string, unknown>) => String(object.primary_source_id || '')).filter(Boolean))]
  const sourceNameById = new Map<string, string>()
  if (sourceIds.length) {
    const { data: sources, error: sourceError } = await client.from('knowledge_sources_v2').select('id,name').in('id', sourceIds)
    if (sourceError) throw sourceError
    for (const source of sources || []) sourceNameById.set(String(source.id), String(source.name || 'Kurumsal bilgi kaynağı'))
  }

  const ranked = [...eligible].sort((left: Record<string, unknown>, right: Record<string, unknown>) => {
    const leftSpace = spaceById.get(String(left.knowledge_space_id)) as Record<string, unknown> | undefined
    const rightSpace = spaceById.get(String(right.knowledge_space_id)) as Record<string, unknown> | undefined
    const leftRank = leftSpace?.scope_type === 'project' ? 0 : 1
    const rightRank = rightSpace?.scope_type === 'project' ? 0 : 1
    if (leftRank !== rightRank) return leftRank - rightRank
    return String(left.canonical_key || '').localeCompare(String(right.canonical_key || ''))
  })

  const selectedByCanonical = new Map<string, Record<string, unknown>>()
  for (const object of ranked) {
    const key = String(object.canonical_key || '').toLocaleLowerCase('en-US')
    if (key && !selectedByCanonical.has(key)) selectedByCanonical.set(key, object)
  }
  const selected = [...selectedByCanonical.values()].sort((left, right) => String(left.canonical_key || '').localeCompare(String(right.canonical_key || '')))

  const records = selected.map(object => {
    const version = versionByObjectId.get(String(object.id)) as Record<string, unknown>
    const space = spaceById.get(String(object.knowledge_space_id)) as Record<string, unknown> | undefined
    return {
      canonicalKey: String(object.canonical_key || ''),
      objectType: String(object.object_type || ''),
      name: String(object.name || ''),
      title: safeText(version.title, 500),
      summary: safeText(version.summary, 1_200),
      content: safeText(version.content, 8_000),
      scope: space?.scope_type === 'project' ? 'project' : 'global',
    }
  })

  const citationSources: original.AssistantSourceRef[] = selected.map(object => {
    const version = versionByObjectId.get(String(object.id)) as Record<string, unknown>
    const sourceId = String(object.primary_source_id || '')
    return {
      sourceId: sourceId || undefined,
      sourceName: sourceNameById.get(sourceId) || 'Kurumsal bilgi kaynağı',
      canonicalKey: String(object.canonical_key || ''),
      objectType: String(object.object_type || ''),
      title: safeText(version.title, 500),
    }
  })

  return {
    output: JSON.stringify({ securityNotice: 'VERIFIED_KNOWLEDGE_DATA. Records are current published objects whose authoritative text explicitly contains the requested technical reference.', technicalReference: ref, requestedObjectTypes: objectTypes, records }),
    sources: citationSources,
    summary: { technicalReference: ref, requestedObjectTypes: objectTypes, recordCount: records.length, citationReady: true, deterministicTechnicalReferenceLookup: true },
  }
}

export async function executeAssistantTool(client: any, workspaceId: string, toolName: string, rawArguments: unknown): Promise<original.AssistantToolExecution> {
  if (toolName !== 'get_objects_by_technical_reference') return original.executeAssistantTool(client, workspaceId, toolName, rawArguments)
  const args = rawArguments && typeof rawArguments === 'object' ? rawArguments as Record<string, unknown> : {}
  return getObjectsByTechnicalReference(client, workspaceId, String(args.technicalReference || ''), args.objectTypes)
}
