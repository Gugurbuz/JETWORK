import {
  ASSISTANT_KNOWLEDGE_TOOLS as baseTools,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsEvidenceBoundaryV2.ts'

export * from './assistantToolsEvidenceBoundaryV2.ts'

const rewriteTool = (tool: any) => {
  if (tool?.name === 'search_document') return {
    ...tool,
    description: 'Search prose documents and business-rule documents for process steps, policies, explanations, how-to instructions, narrative requirements, or facts likely written inside a document. Do not use this as the first choice for named ABAP classes/methods/functions, technical identifiers, message codes, error/message lists, or catalog families; use get_objects_by_technical_reference or search_knowledge_catalog for those.',
  }
  if (tool?.name === 'search_knowledge_catalog') return {
    ...tool,
    description: 'Broad discovery across published structured knowledge. Prefer this for technical concepts, error/message families, message codes, ABAP identifiers, classes, methods, functions, tables, and other catalog objects when an exact technical reference is not yet known. Results can expose catalogFamily metadata; when the user asks for all/list/count for that family, enumerate it with list_knowledge_catalog instead of repeating semantic searches.',
  }
  if (tool?.name === 'get_objects_by_technical_reference') return {
    ...tool,
    description: 'Resolve a known or likely technical identifier using exact identity and authoritative relations first. Prefer this for named ABAP methods/classes/functions, message codes, or identifiers containing technical separators. It may return relation-backed messages/functions and relation-only canonical identities. Do not broaden to document search unless the requested fact is genuinely prose/document content.',
  }
  return tool
}

export const ASSISTANT_KNOWLEDGE_TOOLS = (baseTools as any[]).map(rewriteTool) as any

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  return baseExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
}
