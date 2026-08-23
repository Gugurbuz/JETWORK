import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool as evidenceExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsTechnicalReferenceQuality.ts'

export * from './assistantToolsTechnicalReferenceQuality.ts'
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
    const resolved = await evidenceExecuteAssistantTool(
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

  return evidenceExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
}
