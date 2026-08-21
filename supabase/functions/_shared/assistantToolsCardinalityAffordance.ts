import {
  ASSISTANT_KNOWLEDGE_TOOLS as baseTools,
  executeAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRespectModelTypes.ts'

export * from './assistantToolsRespectModelTypes.ts'
export { executeAssistantTool }

export const ASSISTANT_KNOWLEDGE_TOOLS = baseTools.map((tool: any) => {
  const name = String(tool?.name || '')

  if (name === 'search_knowledge_catalog') {
    return {
      ...tool,
      description: 'Search the published structured knowledge catalog for technical or catalog evidence such as messages/errors, classes, methods, functions, tables, components, services, identifiers and bounded object families. Prefer this tool over search_document when the user asks which technical records/errors/messages/objects exist or are related. Pass the objectTypes that the primary model actually wants; do not broaden them merely for recall. This is discovery, not exhaustive enumeration. If verified results/familyPreview already answer a request for examples, answer from them instead of doing more research.',
    }
  }

  if (name === 'search_document') {
    return {
      ...tool,
      description: 'Search narrative/prose knowledge such as business-process instructions, policies, training material, procedural documentation and business rules when the answer depends on document text. Do NOT use this as the primary tool for technical message/error inventories, class/method/function/table catalogs, or identifier-family enumeration; use search_knowledge_catalog / exact technical-reference tools for those. Read the selected document before citing document content.',
    }
  }

  if (name === 'list_knowledge_catalog') {
    return {
      ...tool,
      description: 'Enumerate a published catalog family or bounded object set. This tool is for COMPLETE/EXHAUSTIVE expansion: use it when the user asks for the whole set, all matching records, a complete inventory, or an otherwise unbounded inventory question whose natural answer is the full matching set. Do NOT use it merely to provide a few examples, representative samples, or a short answer when verified search/familyPreview evidence already contains enough records. For a representative answer, answer from verified preview evidence without enumerating the full family.',
    }
  }

  return tool
}) as typeof baseTools

export type { AssistantToolExecution }
