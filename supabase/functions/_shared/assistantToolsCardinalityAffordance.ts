import {
  ASSISTANT_KNOWLEDGE_TOOLS as baseTools,
  executeAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRespectModelTypes.ts'

export * from './assistantToolsRespectModelTypes.ts'
export { executeAssistantTool }

export const ASSISTANT_KNOWLEDGE_TOOLS = baseTools.map((tool: any) => {
  if (String(tool?.name || '') !== 'list_knowledge_catalog') return tool
  return {
    ...tool,
    description: 'Enumerate a published catalog family or bounded object set. This tool is for COMPLETE/EXHAUSTIVE expansion: use it when the user asks for the whole set, all matching records, a complete inventory, a count that requires full enumeration, or an unbounded inventory answer that must be complete. Do NOT use it merely to provide a few examples, representative samples, or a short answer when verified search/familyPreview evidence already contains enough records. For a representative answer, answer from verified preview evidence without enumerating the full family.',
  }
}) as typeof baseTools

export type { AssistantToolExecution }
