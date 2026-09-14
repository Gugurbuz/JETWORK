import {
  ASSISTANT_KNOWLEDGE_TOOLS as BASE_ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantSourceRef,
  type AssistantToolExecution,
} from './assistantTools.ts'
import { executeWindowedAbapSource } from './abapSourceWindowTool.ts'
import {
  RETRIEVE_JETBASE_EVIDENCE_TOOL,
  RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME,
  executeRetrieveJetbaseEvidence,
} from './jetbaseEvidenceTool.ts'

export const ASSISTANT_KNOWLEDGE_TOOLS = [
  RETRIEVE_JETBASE_EVIDENCE_TOOL,
  ...BASE_ASSISTANT_KNOWLEDGE_TOOLS,
] as const
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

  if (toolName === RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME) {
    return executeRetrieveJetbaseEvidence({
      client,
      workspaceId,
      args,
      search: (innerClient, innerWorkspaceId, innerToolName, innerArgs) =>
        baseExecuteAssistantTool(innerClient, innerWorkspaceId, innerToolName, innerArgs),
    })
  }

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
