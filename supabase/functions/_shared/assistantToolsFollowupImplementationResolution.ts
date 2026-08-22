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

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  if (toolName !== 'get_objects_by_technical_reference') {
    return baseExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
  }

  const args = rawArguments && typeof rawArguments === 'object'
    ? { ...(rawArguments as Record<string, unknown>) }
    : {}
  const resolved = await resolveFollowupReference(client, workspaceId)
  if (resolved) {
    args.technicalReference = resolved.reference
    args.verificationMode = 'implementation'
    args.objectTypes = null
  }

  const result = await baseExecuteAssistantTool(client, workspaceId, toolName, args)
  if (!resolved) return result

  let payload: any = null
  try { payload = typeof result.output === 'string' ? JSON.parse(result.output) : result.output } catch { payload = null }
  return {
    ...result,
    output: JSON.stringify({
      ...(payload && typeof payload === 'object' ? payload : {}),
      conversationalReferenceResolved: true,
      resolvedTechnicalReference: resolved.reference,
      implementationIntent: true,
      implementationRoutingInstruction: 'The user asked for implementation/source. Follow relation-backed method/function records with get_abap_source before answering.',
    }),
    summary: {
      ...(result.summary || {}),
      conversationalReferenceResolved: 1,
      resolvedTechnicalReference: resolved.reference,
      implementationIntent: 1,
    },
  }
}
