import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantToolExecution,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/6da36bb5146e0a088d0dab5916ce188eb0e2097a/supabase/functions/_shared/assistantToolsCardinalityAffordance.ts'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/6da36bb5146e0a088d0dab5916ce188eb0e2097a/supabase/functions/_shared/assistantToolsCardinalityAffordance.ts'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const SOURCE_INTENT = /\b(abap|kod(?:u|unu|unu)?|source|kaynak|implementasyon|implementation)\b/iu
const SHORT_MESSAGE_REF = /(?<![A-Z0-9_])(\d{3})(?!\d)/g
const FULL_MESSAGE_REF = /\b([A-Z][A-Z0-9_]{2,})[-\s](\d{3})\b/g

const normalizeMessageCode = (messageClass: string, number: string) =>
  `${messageClass.toUpperCase()}-${number.padStart(3, '0')}`

async function resolveFollowupReference(
  client: any,
  workspaceId: string,
): Promise<{ reference: string; sourceIntent: boolean } | null> {
  const { data, error } = await client
    .from('messages')
    .select('role,text,created_at')
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'model'])
    .order('created_at', { ascending: false })
    .limit(8)
  if (error || !Array.isArray(data) || !data.length) return null

  const latestUserIndex = data.findIndex((row: any) => row?.role === 'user' && String(row?.text || '').trim())
  if (latestUserIndex < 0) return null
  const currentUserText = String(data[latestUserIndex]?.text || '').trim()
  const sourceIntent = SOURCE_INTENT.test(currentUserText)
  if (!sourceIntent) return null

  const explicitCodes = [...currentUserText.matchAll(FULL_MESSAGE_REF)]
    .map(match => normalizeMessageCode(match[1], match[2]))
  if (explicitCodes.length === 1) return { reference: explicitCodes[0], sourceIntent }

  const shortRefs = [...currentUserText.matchAll(SHORT_MESSAGE_REF)].map(match => match[1])
  if (shortRefs.length !== 1) return null
  const shortRef = shortRefs[0]

  const previousAssistant = data
    .slice(latestUserIndex + 1)
    .find((row: any) => row?.role === 'model' && String(row?.text || '').trim())
  if (!previousAssistant) return null

  const candidates = [...String(previousAssistant.text || '').matchAll(FULL_MESSAGE_REF)]
    .map(match => normalizeMessageCode(match[1], match[2]))
    .filter(code => code.endsWith(`-${shortRef}`))
  const unique = [...new Set(candidates)]
  if (unique.length !== 1) return null
  return { reference: unique[0], sourceIntent }
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function accessibleSpaceIds(client: any, workspaceId: string): Promise<string[]> {
  const { data: workspace } = await client.from('workspaces').select('project_id').eq('id', workspaceId).maybeSingle()
  const [globalResult, projectResult] = await Promise.all([
    client.from('knowledge_spaces').select('id').eq('scope_type', 'global'),
    workspace?.project_id
      ? client.from('knowledge_spaces').select('id').eq('project_id', String(workspace.project_id))
      : Promise.resolve({ data: [], error: null }),
  ])
  return [...new Set([...(globalResult.data || []), ...(projectResult.data || [])].map((row: any) => String(row.id)).filter(Boolean))]
}

function targetedSnippet(content: string, messageClass: string, number: string): string | null {
  const source = String(content || '')
  if (!source) return null
  const patterns = [
    new RegExp(`MESSAGE\\s+[A-Z]?${escapeRegex(number)}\\s*\\(\\s*${escapeRegex(messageClass)}\\s*\\)`, 'iu'),
    new RegExp(`iv_msg_number\\s*=\\s*['\"]${escapeRegex(number)}['\"]`, 'iu'),
  ]
  let index = -1
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    if (match && (index < 0 || match.index < index)) index = match.index
  }
  if (index < 0) return null
  const start = Math.max(0, index - 1400)
  const end = Math.min(source.length, index + 2600)
  return source.slice(start, end)
}

async function implementationEvidenceForMessage(
  client: any,
  workspaceId: string,
  reference: string,
) {
  const match = /^([A-Z][A-Z0-9_]*)-(\d{3})$/.exec(reference)
  if (!match) return []
  const messageClass = match[1]
  const number = match[2]
  const targetCanonicalKey = `message:${reference.toLowerCase()}`
  const spaceIds = await accessibleSpaceIds(client, workspaceId)
  if (!spaceIds.length) return []

  const { data: relations, error: relationError } = await client
    .from('knowledge_relations_v2')
    .select('source_canonical_key,relation_type,target_canonical_key,evidence')
    .eq('active', true)
    .eq('target_canonical_key', targetCanonicalKey)
    .eq('relation_type', 'EMITS_MESSAGE')
    .in('knowledge_space_id', spaceIds)
    .limit(30)
  if (relationError || !relations?.length) return []

  const sourceKeys = [...new Set(relations.map((row: any) => String(row.source_canonical_key || '')).filter(Boolean))]
  const { data: objects, error: objectError } = await client
    .from('knowledge_objects_v2')
    .select('canonical_key,object_type,name,published_version_id,primary_source_id')
    .eq('publication_status', 'published')
    .in('knowledge_space_id', spaceIds)
    .in('canonical_key', sourceKeys)
  if (objectError || !objects?.length) return []

  const versionIds = [...new Set(objects.map((row: any) => String(row.published_version_id || '')).filter(Boolean))]
  const sourceIds = [...new Set(objects.map((row: any) => String(row.primary_source_id || '')).filter(Boolean))]
  const [versionsResult, sourcesResult] = await Promise.all([
    client.from('knowledge_object_versions_v2').select('id,title,content').in('id', versionIds),
    sourceIds.length
      ? client.from('knowledge_sources_v2').select('id,name').in('id', sourceIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  const versions = new Map((versionsResult.data || []).map((row: any) => [String(row.id), row]))
  const sourceNames = new Map((sourcesResult.data || []).map((row: any) => [String(row.id), String(row.name || 'Kurumsal bilgi kaynağı')]))

  return objects.flatMap((object: any) => {
    const version: any = versions.get(String(object.published_version_id || ''))
    const snippet = targetedSnippet(String(version?.content || ''), messageClass, number)
    if (!snippet) return []
    return [{
      canonicalKey: String(object.canonical_key || ''),
      objectType: String(object.object_type || ''),
      name: String(object.name || ''),
      title: String(version?.title || object.name || ''),
      sourceId: object.primary_source_id ? String(object.primary_source_id) : undefined,
      sourceName: sourceNames.get(String(object.primary_source_id || '')) || 'Kurumsal bilgi kaynağı',
      messageCode: reference,
      relationType: 'EMITS_MESSAGE',
      literalImplementationSnippet: snippet,
      evidenceInstruction: `This snippet is centered on the literal ABAP implementation for ${reference}. Prefer this exact evidence over unrelated examples from the same method.`,
    }]
  })
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const resolved = await resolveFollowupReference(client, workspaceId)
  const args = rawArguments && typeof rawArguments === 'object'
    ? { ...(rawArguments as Record<string, unknown>) }
    : {}

  if (resolved && toolName === 'get_objects_by_technical_reference') {
    args.technicalReference = resolved.reference
    args.verificationMode = 'implementation'
    args.objectTypes = null
  }
  if (resolved && toolName === 'search_knowledge_catalog') {
    args.query = resolved.reference
    args.objectTypes = null
  }

  const result = await baseExecuteAssistantTool(client, workspaceId, toolName, args)
  if (!resolved || !['get_objects_by_technical_reference', 'search_knowledge_catalog'].includes(toolName)) return result

  const implementationEvidence = await implementationEvidenceForMessage(client, workspaceId, resolved.reference)
  let payload: any = null
  try { payload = typeof result.output === 'string' ? JSON.parse(result.output) : result.output } catch { payload = null }

  const extraSources = implementationEvidence.map((record: any) => ({
    sourceId: record.sourceId,
    sourceName: record.sourceName,
    canonicalKey: record.canonicalKey,
    objectType: record.objectType,
    title: record.title,
  }))

  return {
    ...result,
    output: JSON.stringify({
      ...(payload && typeof payload === 'object' ? payload : {}),
      conversationalReferenceResolved: true,
      resolvedTechnicalReference: resolved.reference,
      implementationIntent: true,
      implementationEvidence,
      implementationRoutingInstruction: implementationEvidence.length
        ? `Literal ABAP evidence for ${resolved.reference} is present in implementationEvidence. Answer from that snippet; do not claim the implementation is unavailable.`
        : 'The user asked for implementation/source. Follow relation-backed method/function records with get_abap_source before answering.',
    }),
    sources: [...(result.sources || []), ...extraSources].filter((source: any, index: number, all: any[]) =>
      all.findIndex(item => `${item.canonicalKey || ''}|${item.sourceId || ''}` === `${source.canonicalKey || ''}|${source.sourceId || ''}`) === index
    ),
    summary: {
      ...(result.summary || {}),
      conversationalReferenceResolved: 1,
      resolvedTechnicalReference: resolved.reference,
      implementationIntent: 1,
      targetedImplementationEvidenceCount: implementationEvidence.length,
    },
  }
}
