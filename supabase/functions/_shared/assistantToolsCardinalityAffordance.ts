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
      description: 'Search the published structured knowledge catalog for technical or catalog evidence such as messages/errors, classes, methods, functions, tables, components, services, identifiers and bounded object families. Prefer this tool over search_document when the user asks which technical records/errors/messages/objects exist or are related. Set resultMode="preview" for examples/representative/bounded answers. Set resultMode="complete" when the natural answer must cover the full matching inventory. The semantic cardinality decision belongs to the primary model; the executor only enforces it.',
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
      description: 'Enumerate a published catalog family or bounded object set after structured discovery identifies the family. Set responseMode="preview" only for a bounded page. Set responseMode="complete" when the primary model previously chose complete cardinality or the requested answer must include the authoritative whole set. Do not replace a sufficient verified preview with exhaustive enumeration when resultMode was preview.',
    }
  }

  return tool
}) as typeof baseTools

export type { AssistantToolExecution }
