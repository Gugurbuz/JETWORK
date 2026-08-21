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
      description: 'Search the published structured knowledge catalog for technical/catalog evidence such as messages/errors, classes, methods, functions, tables, components, services, identifiers and object families. Prefer this over search_document for technical inventories. Cardinality rule for the PRIMARY MODEL: choose resultMode="complete" for open-ended inventory questions such as “hangi/neler hata mesajları var?”, “hangi mesajları üretiyor?”, “what errors/messages exist?”, or other requests whose answer is naturally the matching set. Choose resultMode="preview" ONLY when the user explicitly asks for a few/examples/representative/sample/short subset or otherwise clearly bounds the amount. Once preview is chosen and verified familyPreview is sufficient, do not later change the same turn to complete unless the user explicitly requested completeness. The executor never infers cardinality from keywords; it only enforces this model-selected field.',
    }
  }

  if (name === 'search_document') {
    return {
      ...tool,
      description: 'Search narrative/prose knowledge such as business-process instructions, policies, training material, procedural documentation and business rules when the answer depends on document text. Preserve the user’s answer-bearing qualifiers in the search query: do not drop constraints such as duration/time, status, channel, direction, before/after, role, condition, or requested outcome. For example, if the user asks how long something is valid, search for the subject together with validity/duration/time rather than only the subject name. Do NOT use this as the primary tool for technical message/error inventories, class/method/function/table catalogs, or identifier-family enumeration; use search_knowledge_catalog / exact technical-reference tools for those. Read the selected document before citing document content.',
    }
  }

  if (name === 'list_knowledge_catalog') {
    return {
      ...tool,
      description: 'Enumerate a published catalog family or bounded object set after structured discovery identifies the family. Use responseMode="complete" when the primary model chose complete cardinality for the inventory. Use responseMode="preview" only when the user explicitly requested a bounded subset. If the same turn already has sufficient verified preview evidence and resultMode was preview, do not paginate or enumerate more records.',
    }
  }

  return tool
}) as typeof baseTools

export type { AssistantToolExecution }
