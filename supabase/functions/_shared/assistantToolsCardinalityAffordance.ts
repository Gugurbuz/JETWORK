import {
  ASSISTANT_KNOWLEDGE_TOOLS as baseTools,
  executeAssistantTool as baseExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsRespectModelTypes.ts'

export * from './assistantToolsRespectModelTypes.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

type AnswerCardinality = { scope: 'bounded' | 'exhaustive'; maxItems: number | null }

const cardinalityArgs = (rawArguments: unknown) => {
  const args = rawArguments && typeof rawArguments === 'object' ? { ...(rawArguments as Record<string, unknown>) } : {}
  const scope = String(args.answerScope || '') === 'exhaustive' ? 'exhaustive' : 'bounded'
  const rawMax = args.answerMaxItems
  delete args.answerScope
  delete args.answerMaxItems
  delete args.maxItems
  const maxItems = scope === 'exhaustive'
    ? null
    : Math.max(1, Math.min(25, Math.trunc(Number(rawMax) || 5)))
  args.resultMode = maxItems == null ? 'complete' : 'preview'
  return { args, cardinality: { scope, maxItems } as AnswerCardinality }
}

const applyDeclaredCardinality = (
  result: AssistantToolExecution,
  cardinality: AnswerCardinality,
): AssistantToolExecution => {
  const { scope, maxItems } = cardinality
  const payload: any = parse(result.output)
  const records = Array.isArray(payload?.records)
    ? payload.records
    : Array.isArray(payload?.records?.items)
      ? payload.records.items
      : []
  const totalCount = Number(payload?.totalCount || result.summary?.totalCount || records.length) || records.length

  if (scope === 'exhaustive') {
    return {
      ...result,
      output: JSON.stringify({ ...payload, resultMode: 'complete', answerScope: scope, answerMaxItems: null }),
      summary: { ...(result.summary || {}), resultMode: 'complete', answerScope: scope, answerMaxItems: null, primaryModelCardinalityRespected: 1 },
    }
  }

  const selected = records.slice(0, maxItems || 5)
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
      answerScope: scope,
      answerMaxItems: maxItems,
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
      answerScope: scope,
      answerMaxItems: maxItems,
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
  const { args, cardinality } = cardinalityArgs(rawArguments)
  const result = await baseExecuteAssistantTool(client, workspaceId, toolName, args)
  return applyDeclaredCardinality(result, cardinality)
}

const withAnswerScopeSchema = (tool: any, extraProperties: Record<string, unknown> = {}) => {
  const properties = { ...(tool.parameters?.properties || {}) }
  delete properties.resultMode
  delete properties.maxItems
  return {
    ...tool.parameters,
    properties: {
      ...properties,
      ...extraProperties,
      answerScope: {
        type: 'string',
        enum: ['bounded', 'exhaustive'],
        description: 'Coverage of the FINAL ANSWER, not a search limit. Use bounded only when the user explicitly asks for a few/examples/a numbered or otherwise limited subset. Use exhaustive for open-ended inventory questions such as “hangi hatalar var?”, “hatalar neler?”, “hangi mesajları üretiyor?” when the user did not bound the requested set.',
      },
      answerMaxItems: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 25,
        description: 'Maximum inventory items to PRESENT in the final answer. Required integer only when answerScope=bounded; use null when answerScope=exhaustive. This is NOT a retrieval/search-performance limit.',
      },
    },
    required: [...new Set([...(tool.parameters?.required || []).filter((name: string) => !['resultMode','maxItems'].includes(name)), ...Object.keys(extraProperties), 'answerScope', 'answerMaxItems'])],
    additionalProperties: false,
  }
}

export const ASSISTANT_KNOWLEDGE_TOOLS = baseTools.map((tool: any) => {
  const name = String(tool?.name || '')

  if (name === 'get_objects_by_technical_reference') {
    return {
      ...tool,
      description: 'Authoritative relation/identity lookup for a NAMED technical identifier. Use this first when the user supplies a concrete class/method/function/message/table/technical name and asks about its relations, implementation/source availability, emitted messages, called functions, usage, or related technical objects. Set verificationMode="implementation" only when source-code evidence is required; otherwise use relation. Separately decide FINAL ANSWER coverage: answerScope="bounded" only for explicit requests such as “birkaç”, “3 tane”, “örnek”; answerScope="exhaustive" for unbounded set questions such as “hangi mesajları üretiyor?”. answerMaxItems is the number to present only for bounded, otherwise null.',
      parameters: withAnswerScopeSchema(tool, {
        verificationMode: {
          type: 'string',
          enum: ['relation', 'implementation'],
          description: 'relation for identity/relationship evidence; implementation only when source-code evidence is required.',
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
      description: 'Search the published structured knowledge catalog for category/family discovery and technical/catalog evidence. Use this for broad or natural-language discovery. Decide FINAL ANSWER coverage independently of search efficiency: answerScope="bounded" only when the user explicitly asks for a few/examples/a numbered or otherwise limited subset; answerScope="exhaustive" for an unbounded inventory question such as “Costta alınacak hatalar neler?” or “hangi hata mesajları var?”. Set answerMaxItems to the requested presentation count for bounded; set it to null for exhaustive. Do not use a small bounded scope merely to make retrieval cheaper.',
      parameters: withAnswerScopeSchema(tool),
    }
  }

  if (name === 'search_document') {
    return {
      ...tool,
      description: 'Search narrative/prose knowledge such as business-process instructions, policies, training material, procedural documentation and business rules. Preserve answer-bearing qualifiers such as duration/time, status, channel, direction, role, condition, and requested outcome. A search result is discovery evidence only; read the selected document before treating document text as final evidence.',
    }
  }

  if (name === 'list_knowledge_catalog') {
    return {
      ...tool,
      description: 'Enumerate a published catalog family after the primary model declared answerScope="exhaustive". Do not invoke full enumeration after a bounded answerScope decision. Do not use family enumeration instead of exact technical-reference lookup for a named method/class/function relation or implementation question.',
    }
  }

  return tool
}) as typeof baseTools

export type { AssistantToolExecution }
