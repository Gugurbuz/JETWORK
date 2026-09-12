import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantSourceRef,
  type AssistantToolExecution,
} from './assistantTools.ts'
import { executeWindowedAbapSource } from './abapSourceWindowTool.ts'

export { ASSISTANT_KNOWLEDGE_TOOLS }
export type { AssistantSourceRef, AssistantToolExecution }

const normalizeCanonicalKey = (value: unknown) =>
  String(value ?? '').trim().toLocaleLowerCase('en-US')

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const args = rawArguments && typeof rawArguments === 'object'
    ? rawArguments as Record<string, unknown>
    : {}

  if (toolName === 'get_abap_source') {
    const canonicalKey = normalizeCanonicalKey(args.canonicalKey)
    if (!canonicalKey) throw new Error('canonicalKey is required.')
    return executeWindowedAbapSource({
      client,
      workspaceId,
      canonicalKey,
      focusIdentifiers: args.focusIdentifiers,
      sourceCursor: args.focusCursor,
      windowSize: args.focusWindowSize,
    })
  }

  return baseExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
}
