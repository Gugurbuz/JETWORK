import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as unifiedExecuteAssistantTool,
  type AssistantToolExecution,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/17435897f0c6a622aa3b97815752d99f92b4974e/supabase/functions/_shared/assistantToolsUnifiedKnowledge.ts?authoritative-terminal-base=1'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/17435897f0c6a622aa3b97815752d99f92b4974e/supabase/functions/_shared/assistantToolsUnifiedKnowledge.ts?authoritative-terminal-base=1'
export { ASSISTANT_KNOWLEDGE_TOOLS }

const AUTHORITATIVE_FIRST_PASS_TOOLS = new Set([
  'get_message_detail',
  'search_knowledge_catalog',
  'get_related_objects',
  'search_document',
  'get_knowledge_object',
  'get_document_content',
  'get_objects_by_technical_reference',
  'resolve_knowledge_evidence',
])

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  if (AUTHORITATIVE_FIRST_PASS_TOOLS.has(toolName)) {
    const resolved = await unifiedExecuteAssistantTool(
      client,
      workspaceId,
      'resolve_knowledge_evidence',
      rawArguments,
    )
    if (resolved.summary?.authoritativeResolution === true) {
      return {
        ...resolved,
        summary: {
          ...resolved.summary,
          terminalAuthoritativeEvidence: true,
          originalRequestedTool: toolName,
        },
      }
    }
  }

  return unifiedExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
}
