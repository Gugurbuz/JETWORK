import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  ARTIFACT_BUNDLE_TOOL,
  ARTIFACT_BUNDLE_TOOL_NAME,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL_NAME,
  executeAssistantTool as executeAgenticRuntimeV1,
  type AssistantSourceRef,
  type AssistantToolExecution,
} from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@c6f043da2ce21232e2e992480dae956ef0e9f2c6/supabase/functions/_shared/assistantToolsAgenticRuntime.ts?knowledge-runtime-v2-base=1'

export {
  ASSISTANT_KNOWLEDGE_TOOLS,
  ARTIFACT_BUNDLE_TOOL,
  ARTIFACT_BUNDLE_TOOL_NAME,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL_NAME,
}
export type { AssistantSourceRef, AssistantToolExecution }

export const KNOWLEDGE_RUNTIME_VERSION = 'knowledge-runtime-v2'

const clean = (value: unknown, max = 320) => String(value ?? '').trim().slice(0, max)
const canonicalPart = (value: string, prefix: string) => (
  value.toLocaleLowerCase('en-US').startsWith(`${prefix}:`)
    ? value.slice(prefix.length + 1)
    : value
)

// Canonical grammar resolution, not semantic routing: when the controller has
// already supplied exactly one ABAP class entity and one member entity, compose
// the identity the catalog uses instead of broad-searching each token separately.
const ABAP_CLASS_ENTITY = /^(?:class:)?(?:ZCL_|CL_|LCL_|ZIF_|IF_)[A-Z0-9_]+$/i
const ABAP_MEMBER_ENTITY = /^(?:method:)?[A-Z][A-Z0-9_]{2,}$/i

export const composeCanonicalMemberEntity = (entities: string[]): string | null => {
  const classes = entities.filter(entity => ABAP_CLASS_ENTITY.test(entity))
  const members = entities.filter(entity => (
    ABAP_MEMBER_ENTITY.test(entity)
    && !ABAP_CLASS_ENTITY.test(entity)
    && !/^(?:function|message|table|interface|document|business_rule):/i.test(entity)
  ))
  if (classes.length !== 1 || members.length !== 1) return null
  const className = canonicalPart(classes[0], 'class').toLocaleLowerCase('en-US')
  const memberName = canonicalPart(members[0], 'method').toLocaleLowerCase('en-US')
  return className && memberName ? `method:${className}/${memberName}` : null
}

const normalizeResearchArguments = (rawArguments: unknown) => {
  const args = rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
    ? { ...(rawArguments as Record<string, unknown>) }
    : {}
  const entities = Array.isArray(args.entities)
    ? [...new Set(args.entities.map(value => clean(value)).filter(Boolean))].slice(0, 8)
    : []
  const composed = composeCanonicalMemberEntity(entities)
  if (!composed) return args

  const consumed = new Set(entities.filter(entity => (
    ABAP_CLASS_ENTITY.test(entity)
    || (ABAP_MEMBER_ENTITY.test(entity) && !ABAP_CLASS_ENTITY.test(entity))
  )))
  args.entities = [composed, ...entities.filter(entity => !consumed.has(entity))].slice(0, 8)
  return args
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const normalized = toolName === HIGH_LEVEL_KNOWLEDGE_TOOL_NAME
    ? normalizeResearchArguments(rawArguments)
    : rawArguments
  const result = await executeAgenticRuntimeV1(client, workspaceId, toolName, normalized)
  if (toolName !== HIGH_LEVEL_KNOWLEDGE_TOOL_NAME) return result
  return {
    ...result,
    summary: {
      ...result.summary,
      knowledgeRuntimeVersion: KNOWLEDGE_RUNTIME_VERSION,
      canonicalEntityComposed: Boolean(
        rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
        && composeCanonicalMemberEntity(Array.isArray((rawArguments as Record<string, unknown>).entities)
          ? ((rawArguments as Record<string, unknown>).entities as unknown[]).map(value => clean(value)).filter(Boolean)
          : [])
      ),
    },
  }
}
