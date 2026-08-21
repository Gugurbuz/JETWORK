import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as relationExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRelationFirstQuality.ts'

export * from './assistantToolsRelationFirstQuality.ts'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const normalizeNullableCursor = (value: unknown) => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text || ['null', 'none', 'nil', 'undefined'].includes(text.toLowerCase())) return null
  return text
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const args = rawArguments && typeof rawArguments === 'object'
    ? { ...(rawArguments as Record<string, unknown>) }
    : {}

  if (toolName === 'list_knowledge_catalog') {
    args.cursor = normalizeNullableCursor(args.cursor)
  }

  return relationExecuteAssistantTool(client, workspaceId, toolName, args)
}
