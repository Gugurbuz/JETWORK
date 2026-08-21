import {
  ASSISTANT_KNOWLEDGE_TOOLS as baseTools,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRespectModelTypes.ts'

export * from './assistantToolsRespectModelTypes.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const previewTechnicalReferenceResult = (
  result: AssistantToolExecution,
  rawArguments: unknown,
): AssistantToolExecution => {
  const args = rawArguments && typeof rawArguments === 'object' ? rawArguments as Record<string, unknown> : {}
  if (String(args.resultMode || '') !== 'preview') return result

  const payload: any = parse(result.output)
  const records = Array.isArray(payload?.records)
    ? payload.records
    : Array.isArray(payload?.records?.items)
      ? payload.records.items
      : []
  if (records.length <= 5) return result

  const selected = records.slice(0, 5)
  const selectedKeys = new Set(selected.map((record: any) => String(record?.canonicalKey || '')).filter(Boolean))
  const sources = (result.sources || []).filter((source: any) => (
    !source?.canonicalKey || selectedKeys.has(String(source.canonicalKey))
  ))
  const totalCount = Number(payload?.totalCount || result.summary?.totalCount || records.length) || records.length
  const exactFamilyEnumeration = payload?.exactFamilyEnumeration === true || result.summary?.exactFamilyEnumeration === true

  return {
    ...result,
    output: JSON.stringify({
      ...payload,
      records: selected,
      resultMode: 'preview',
      returnedCount: selected.length,
      totalCount,
      complete: false,
      exactFamilyEnumeration,
    }),
    sources,
    summary: {
      ...(result.summary || {}),
      resultCount: selected.length,
      recordCount: selected.length,
      returnedCount: selected.length,
      totalCount,
      complete: false,
      resultMode: 'preview',
      primaryModelCardinalityRespected: 1,
    },
  }
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const result = await baseExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
  if (toolName !== 'get_objects_by_technical_reference') return result
  return previewTechnicalReferenceResult(result, rawArguments)
}

export const ASSISTANT_KNOWLEDGE_TOOLS = baseTools.map((tool: any) => {
  const name = String(tool?.name || '')

  if (name === 'get_objects_by_technical_reference') {
    return {
      ...tool,
      description: 'Authoritative relation/identity lookup for a NAMED technical identifier. When the user supplies a concrete class/method/function/message/table/technical name, use this FIRST for questions about its relations, identity, implementation/source availability, emitted messages, called functions, usage, or related technical objects. Set verificationMode="implementation" when the requested answer depends on source code/implementation details such as ABAP body, SELECTs, MESSAGE statements, parameters/types, or algorithm. Set verificationMode="relation" for relation/identity questions. Also choose resultMode explicitly: resultMode="preview" when the user asks for a few/examples/representative/bounded subset; resultMode="complete" when they ask for the whole related set or do not bound an inventory. The executor enforces this primary-model cardinality, including when a technical reference resolves to a large message family. For implementation requests, the runtime verifies the resolved canonical object with get_abap_source before answering.',
      parameters: {
        ...tool.parameters,
        properties: {
          ...(tool.parameters?.properties || {}),
          verificationMode: {
            type: 'string',
            enum: ['relation', 'implementation'],
            description: 'Primary-model semantic decision: relation for identity/relationship lookup; implementation when source-code evidence is required.',
          },
          resultMode: {
            type: 'string',
            enum: ['preview', 'complete'],
            description: 'Primary-model cardinality decision: preview only for explicitly bounded/few/example requests; complete for the full related inventory.',
          },
        },
        required: [...new Set([...(tool.parameters?.required || []), 'verificationMode', 'resultMode'])],
        additionalProperties: false,
      },
    }
  }

  if (name === 'get_abap_source') {
    return {
      ...tool,
      description: 'Fetch verified ABAP implementation/source for an exact canonical technical object. For a user-supplied named method/function/class, first resolve the canonical identity with get_objects_by_technical_reference using verificationMode="implementation"; the runtime may dispatch this tool automatically from that declared mode. If implementationAvailable=false or evidenceBoundary=metadata_only, do not reconstruct or guess source code, SELECT statements, DDIC types, algorithms, or MESSAGE statements.',
    }
  }

  if (name === 'search_knowledge_catalog') {
    return {
      ...tool,
      description: 'Search the published structured knowledge catalog for category/family discovery and technical/catalog evidence such as errors, classes, methods, functions, tables, components, services and object families. Use this for broad or natural-language discovery when there is no already-named exact technical identifier. Do NOT use this as the primary path when the user names a concrete technical identifier and asks for its relations, source, implementation, code, SELECTs, emitted messages, or called functions; use get_objects_by_technical_reference first. Cardinality rule for the PRIMARY MODEL: choose resultMode="complete" for open-ended inventory questions whose natural answer is the full matching set. Choose resultMode="preview" ONLY when the user explicitly asks for a few/examples/representative/sample/short subset or otherwise clearly bounds the amount. Once preview is chosen, that cardinality choice is stable for the entire turn; later discovery may refine the query but must not escalate preview to complete unless the user changes the request in a later turn. The executor only enforces the model-selected cardinality.',
    }
  }

  if (name === 'search_document') {
    return {
      ...tool,
      description: 'Search narrative/prose knowledge such as business-process instructions, policies, training material, procedural documentation and business rules when the answer depends on document text. Preserve the user’s answer-bearing qualifiers in the search query: do not drop constraints such as duration/time, status, channel, direction, before/after, role, condition, or requested outcome. Do NOT use this as the primary tool for exact named technical implementation/source/code requests, technical message/error inventories, class/method/function/table catalogs, or identifier-family enumeration; use structured/exact technical tools for those. A search result is discovery evidence only; read the selected document before treating document text as final evidence.',
    }
  }

  if (name === 'list_knowledge_catalog') {
    return {
      ...tool,
      description: 'Enumerate a published catalog family or bounded object set after structured discovery identifies the family. Use responseMode="complete" when the primary model chose complete cardinality for a BROAD family/inventory. Do not use family enumeration to answer an exact named method/class/function relation or implementation question when get_objects_by_technical_reference resolves the bounded technical identity. Use responseMode="preview" only when the user requested a bounded subset. If the same turn already chose preview, do not escalate that turn to complete enumeration.',
    }
  }

  return tool
}) as typeof baseTools

export type { AssistantToolExecution }
