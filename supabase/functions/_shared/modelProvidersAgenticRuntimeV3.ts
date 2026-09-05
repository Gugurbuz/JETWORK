export * from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@3937738cbbe7e0910c70612354a6c0dce03f237e/supabase/functions/_shared/modelProvidersAgenticRuntimeV2.ts?agentic-provider-v3-base=1'
import { requestGeminiResponse as requestGeminiResponseV2 } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@3937738cbbe7e0910c70612354a6c0dce03f237e/supabase/functions/_shared/modelProvidersAgenticRuntimeV2.ts?agentic-provider-v3-base=1'

const KNOWLEDGE_TOOL_NAME = 'research_knowledge'

const parseArgs = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const clean = (value: unknown, max = 4_000) => String(value ?? '').trim().slice(0, max)
const uniqueStrings = (values: unknown[], maxItems: number, maxLength: number) => [
  ...new Set(values.map(value => clean(value, maxLength)).filter(Boolean)),
].slice(0, maxItems)

const mergeUsage = (usage: Record<string, number> | undefined, extra: Record<string, number>) => ({
  ...(usage || {}),
  ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, Number((usage || {})[key] || 0) + value])),
})

const collapseResearchCalls = (response: any) => {
  const output = Array.isArray(response?.output) ? response.output as Array<Record<string, unknown>> : []
  const researchCalls = output.filter(item => item?.type === 'function_call' && String(item?.name || '') === KNOWLEDGE_TOOL_NAME)
  if (researchCalls.length <= 1) return response

  const argsList = researchCalls.map(call => parseArgs(call.arguments))
  const requests = uniqueStrings(argsList.map(args => args.request), 8, 1_500)
  const entities = uniqueStrings(argsList.flatMap(args => Array.isArray(args.entities) ? args.entities : []), 8, 320)
  const objectTypes = uniqueStrings(argsList.flatMap(args => Array.isArray(args.objectTypes) ? args.objectTypes : []), 8, 40)
  const maxObjects = Math.max(1, Math.min(6, ...argsList.map(args => Math.trunc(Number(args.maxObjects) || 1))))
  const includeRelations = argsList.some(args => args.includeRelations !== false)
  const mergedArgs = {
    request: requests.join('\n---\n').slice(0, 4_000),
    entities: entities.length ? entities : null,
    objectTypes: objectTypes.length ? objectTypes : null,
    includeRelations,
    maxObjects,
  }

  let kept = false
  const mergedOutput = output.filter(item => {
    if (item?.type !== 'function_call' || String(item?.name || '') !== KNOWLEDGE_TOOL_NAME) return true
    if (kept) return false
    kept = true
    item.arguments = JSON.stringify(mergedArgs)
    return true
  })

  return {
    ...response,
    output: mergedOutput,
    usage: mergeUsage(response?.usage, {
      knowledge_same_round_calls_collapsed: researchCalls.length - 1,
      knowledge_same_round_merged_entities: entities.length,
    }),
  }
}

export async function requestGeminiResponse(input: any): Promise<any> {
  const response = await requestGeminiResponseV2(input)
  return collapseResearchCalls(response)
}
