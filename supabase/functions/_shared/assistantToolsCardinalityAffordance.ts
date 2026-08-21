import {
  ASSISTANT_KNOWLEDGE_TOOLS as baseTools,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRespectModelTypes.ts'

export * from './assistantToolsRespectModelTypes.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const cardinalityArgs = (rawArguments: unknown) => {
  const args = rawArguments && typeof rawArguments === 'object' ? { ...(rawArguments as Record<string, unknown>) } : {}
  const rawMax = args.maxItems
  delete args.maxItems
  const maxItems = rawMax == null ? null : Math.max(1, Math.min(25, Math.trunc(Number(rawMax) || 1)))
  args.resultMode = maxItems == null ? 'complete' : 'preview'
  return { args, maxItems }
}

const applyDeclaredCardinality = (
  result: AssistantToolExecution,
  maxItems: number | null,
): AssistantToolExecution => {
  const payload: any = parse(result.output)
  const records = Array.isArray(payload?.records)
    ? payload.records
    : Array.isArray(payload?.records?.items)
      ? payload.records.items
      : []
  const totalCount = Number(payload?.totalCount || result.summary?.totalCount || records.length) || records.length

  if (maxItems == null) {
    return {
      ...result,
      output: JSON.stringify({ ...payload, resultMode: 'complete', maxItems: null }),
      summary: { ...(result.summary || {}), resultMode: 'complete', maxItems: null, primaryModelCardinalityRespected: 1 },
    }
  }

  // Retrieval may still inspect a wider candidate set, but evidence exposed for a bounded
  // inventory is capped to the primary model's declared answer cardinality.
  const selected = records.slice(0, maxItems)
  const selectedKeys = new Set(selected.map((record: any) => String(record?.canonicalKey || '')).filter(Boolean))
  const sources = (result.sources || []).filter((source: any) => !source?.canonicalKey || selectedKeys.has(String(source.canonicalKey)))
  const recordsValue = Array.isArray(payload?.records?.items)
    ? { ...payload.records, items: selected, returnedCount: selected.length, complete: false }
    : selected

  return {
    ...result,
    output: JSON.stringify({
      ...payload,
      records: recordsValue,
      resultMode: 'preview',
      maxItems,
      returnedCount: selected.length,
      totalCount,
      complete: false,
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
      maxItems,
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
  if (!['get_objects_by_technical_reference', 'search_knowledge_catalog'].includes(toolName)) {
    return baseExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
  }
  const { args, maxItems } = cardinalityArgs(rawArguments)
  const result = await baseExecuteAssistantTool(client, workspaceId, toolName, args)
  return applyDeclaredCardinality(result, maxItems)
}

const withMaxItemsSchema = (tool: any, extraProperties: Record<string, unknown> = {}) => {
  const properties = { ...(tool.parameters?.properties || {}) }
  delete properties.resultMode
  return {
    ...tool.parameters,
    properties: {
      ...properties,
      ...extraProperties,
      maxItems: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 25,
        description: 'How many matching inventory items should be returned to the user. Use a small integer matching the request when the user asks for a few/examples/a bounded subset. Use null only when the user wants the whole matching set or gives no bound for a naturally exhaustive inventory.',
      },
    },
    required: [...new Set([...(tool.parameters?.required || []).filter((name: string) => name !== 'resultMode'), ...Object.keys(extraProperties), 'maxItems'])],
    additionalProperties: false,
  }
}

export const ASSISTANT_KNOWLEDGE_TOOLS = baseTools.map((tool: any) => {
  const name = String(tool?.name || '')

  if (name === 'get_objects_by_technical_reference') {
    return {
      ...tool,
      description: 'Authoritative relation/identity lookup for a NAMED technical identifier. Use this first when the user supplies a concrete class/method/function/message/table/technical name and asks about its relations, implementation/source availability, emitted messages, called functions, usage, or related technical objects. Set verificationMode="implementation" only when source-code evidence is required (ABAP body, SELECTs, MESSAGE statements, parameter/types, algorithm); otherwise use relation. Set maxItems to the amount the user actually asked to see: for “birkaç / a few / examples” choose a small integer such as 3–5; for the whole related set use null. The executor enforces exactly this model-declared cardinality.',
      parameters: withMaxItemsSchema(tool, {
        verificationMode: {
          type: 'string',
          enum: ['relation', 'implementation'],
          description: 'Primary-model semantic decision: relation for identity/relationship lookup; implementation only when source-code evidence is required.',
        },
      }),
    }
  }

  if (name === 'get_abap_source') {
    return {
      ...tool,
      description: 'Fetch verified ABAP implementation/source for an exact canonical technical object. Resolve a named method/function/class with get_objects_by_technical_reference using verificationMode="implementation" first. If implementationAvailable=false or evidenceBoundary=metadata_only, do not reconstruct or guess source code, SELECT statements, DDIC types, algorithms, or MESSAGE statements.',
    }
  }

  if (name === 'search_knowledge_catalog') {
    return {
      ...tool,
      description: 'Search the published structured knowledge catalog for category/family discovery and technical/catalog evidence. Use this for broad or natural-language discovery when there is no already-resolved exact technical identifier. Set maxItems to the amount the user actually requested: a small integer (normally 3–5) for “birkaç / few / examples / representative / short subset”; use null only when the requested answer should cover the whole matching inventory. Do not silently turn a bounded request into a full family enumeration. The executor converts this primary-model decision into preview/complete retrieval behavior.',
      parameters: withMaxItemsSchema(tool),
    }
  }

  if (name === 'search_document') {
    return {
      ...tool,
      description: 'Search narrative/prose knowledge such as business-process instructions, policies, training material, procedural documentation and business rules when the answer depends on document text. Preserve answer-bearing qualifiers such as duration/time, status, channel, direction, role, condition, and requested outcome. Do not use this as the primary tool for exact named technical implementation/source/code requests or technical inventories. A search result is discovery evidence only; read the selected document before treating document text as final evidence.',
    }
  }

  if (name === 'list_knowledge_catalog') {
    return {
      ...tool,
      description: 'Enumerate a published catalog family after the primary model has declared that the whole matching set is required. Do not invoke full enumeration after a bounded maxItems decision. Do not use family enumeration instead of exact technical-reference lookup for a named method/class/function relation or implementation question.',
    }
  }

  return tool
}) as typeof baseTools

export type { AssistantToolExecution }
