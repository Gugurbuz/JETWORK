import {
  ASSISTANT_KNOWLEDGE_TOOLS as baseTools,
  executeAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRespectModelTypes.ts'

export * from './assistantToolsRespectModelTypes.ts'
export { executeAssistantTool }

export const ASSISTANT_KNOWLEDGE_TOOLS = baseTools.map((tool: any) => {
  const name = String(tool?.name || '')

  if (name === 'get_objects_by_technical_reference') {
    return {
      ...tool,
      description: 'Authoritative relation/identity lookup for a NAMED technical identifier. When the user supplies a concrete class/method/function/message/table/technical name, use this FIRST for questions about its relations, identity, implementation/source availability, emitted messages, called functions, usage, or related technical objects. For implementation/source requests, resolve the exact canonical technical object here first, then call get_abap_source on the resolved canonicalKey. Do not substitute broad catalog/document discovery for this exact-identifier path. Pass the requested object kinds in objectTypes when the question names a kind such as messages/functions/tables/methods.',
    }
  }

  if (name === 'get_abap_source') {
    return {
      ...tool,
      description: 'Fetch verified ABAP implementation/source for an exact canonical technical object. For a user-supplied named method/function/class, first resolve the canonical identity with get_objects_by_technical_reference, then call this tool on that canonicalKey. If implementationAvailable=false or evidenceBoundary=metadata_only, do not reconstruct or guess source code, SELECT statements, DDIC types, algorithms, or MESSAGE statements.',
    }
  }

  if (name === 'search_knowledge_catalog') {
    return {
      ...tool,
      description: 'Search the published structured knowledge catalog for category/family discovery and technical/catalog evidence such as errors, classes, methods, functions, tables, components, services and object families. Use this for broad or natural-language discovery when there is no already-named exact technical identifier. Do NOT use this as the primary path when the user names a concrete technical identifier and asks for its relations, source, implementation, code, SELECTs, emitted messages, or called functions; use get_objects_by_technical_reference first. Cardinality rule for the PRIMARY MODEL: choose resultMode="complete" for open-ended inventory questions whose natural answer is the full matching set. Choose resultMode="preview" ONLY when the user explicitly asks for a few/examples/representative/sample/short subset or otherwise clearly bounds the amount. Once preview is chosen and verified familyPreview is sufficient, do not later change the same turn to complete unless the user explicitly requested completeness. The executor never infers cardinality from keywords; it only enforces this model-selected field.',
    }
  }

  if (name === 'search_document') {
    return {
      ...tool,
      description: 'Search narrative/prose knowledge such as business-process instructions, policies, training material, procedural documentation and business rules when the answer depends on document text. Preserve the user’s answer-bearing qualifiers in the search query: do not drop constraints such as duration/time, status, channel, direction, before/after, role, condition, or requested outcome. For example, if the user asks how long something is valid, search for the subject together with validity/duration/time rather than only the subject name. Do NOT use this as the primary tool for exact named technical implementation/source/code requests, technical message/error inventories, class/method/function/table catalogs, or identifier-family enumeration; use structured/exact technical tools for those. A search result is discovery evidence only; read the selected document before treating document text as final evidence.',
    }
  }

  if (name === 'list_knowledge_catalog') {
    return {
      ...tool,
      description: 'Enumerate a published catalog family or bounded object set after structured discovery identifies the family. Use responseMode="complete" when the primary model chose complete cardinality for a BROAD family/inventory. Do not use family enumeration to answer an exact named method/class/function relation or implementation question when get_objects_by_technical_reference resolves the bounded technical identity. Use responseMode="preview" only when the user explicitly requested a bounded subset. If the same turn already has sufficient verified preview evidence and resultMode was preview, do not paginate or enumerate more records.',
    }
  }

  return tool
}) as typeof baseTools

export type { AssistantToolExecution }
