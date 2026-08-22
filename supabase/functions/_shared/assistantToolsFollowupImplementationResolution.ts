import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantToolExecution,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/6da36bb5146e0a088d0dab5916ce188eb0e2097a/supabase/functions/_shared/assistantToolsCardinalityAffordance.ts'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/6da36bb5146e0a088d0dab5916ce188eb0e2097a/supabase/functions/_shared/assistantToolsCardinalityAffordance.ts'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const SOURCE_INTENT = /\b(abap|kod(?:u|unu)?|source|kaynak|implementasyon|implementation)\b/iu
const SHORT_MESSAGE_REF = /(?<![A-Z0-9_])(\d{3})(?!\d)/g
const FULL_MESSAGE_REF = /\b([A-Z][A-Z0-9_]{2,})[-\s](\d{3})\b/g
const FOCUSED_DISCOVERY_TOOLS = new Set([
  'get_objects_by_technical_reference',
  'search_knowledge_catalog',
  'search_document',
])

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
    .limit(24)
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

  // Walk backward through recent assistant messages. Stop at the first assistant
  // message that contains a unique fully-qualified message code for the short ref.
  // This preserves conversational recency without losing the entity after one
  // failed assistant answer.
  for (const row of data.slice(latestUserIndex + 1)) {
    if (row?.role !== 'model') continue
    const candidates = [...String(row.text || '').matchAll(FULL_MESSAGE_REF)]
      .map(match => normalizeMessageCode(match[1], match[2]))
      .filter(code => code.endsWith(`-${shortRef}`))
    const unique = [...new Set(candidates)]
    if (unique.length === 1) return { reference: unique[0], sourceIntent }
    if (unique.length > 1) return null
  }
  return null
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
  const start = Math.max(0, index - 1600)
  const end = Math.min(source.length, index + 3000)
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
      evidenceInstruction: `This snippet is centered on the literal ABAP implementation for ${reference}. Answer from this exact evidence and do not claim the implementation is unavailable.`,
    }]
  })
}

async function focusedImplementationResult(
  client: any,
  workspaceId: string,
  reference: string,
): Promise<AssistantToolExecution | null> {
  const implementationEvidence = await implementationEvidenceForMessage(client, workspaceId, reference)
  if (!implementationEvidence.length) return null
  const sources = implementationEvidence.map((record: any) => ({
    sourceId: record.sourceId,
    sourceName: record.sourceName,
    canonicalKey: record.canonicalKey,
    objectType: record.objectType,
    title: record.title,
  }))
  return {
    output: JSON.stringify({
      securityNotice: 'VERIFIED_KNOWLEDGE_DATA.',
      conversationalReferenceResolved: true,
      resolvedTechnicalReference: reference,
      implementationIntent: true,
      resultMode: 'complete',
      records: implementationEvidence,
      implementationEvidence,
      implementationRoutingInstruction: `Literal ABAP evidence for ${reference} is present. Answer directly from literalImplementationSnippet; do not broaden the search and do not claim the implementation is unavailable.`,
    }),
    sources,
    summary: {
      recordCount: implementationEvidence.length,
      citationReady: true,
      resultMode: 'complete',
      conversationalReferenceResolved: 1,
      resolvedTechnicalReference: reference,
      implementationIntent: 1,
      targetedImplementationEvidenceCount: implementationEvidence.length,
      focusedImplementationShortCircuit: 1,
    },
  }
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const resolved = await resolveFollowupReference(client, workspaceId)

  // Once a short conversational reference has been uniquely resolved for a
  // source-code request, do not let the model broaden it back to a generic
  // search. Any discovery tool receives the same focused implementation result.
  if (resolved && FOCUSED_DISCOVERY_TOOLS.has(toolName)) {
    const focused = await focusedImplementationResult(client, workspaceId, resolved.reference)
    if (focused) return focused
  }

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
  if (resolved && toolName === 'search_document') {
    args.query = resolved.reference
  }

  const result = await baseExecuteAssistantTool(client, workspaceId, toolName, args)
  if (!resolved) return result

  return {
    ...result,
    summary: {
      ...(result.summary || {}),
      conversationalReferenceResolved: 1,
      resolvedTechnicalReference: resolved.reference,
      implementationIntent: 1,
    },
  }
}
