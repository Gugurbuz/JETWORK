import {
  requestGeminiResponse as baseRequest,
  type NormalizedModelResponse,
} from './modelProvidersEvidenceSufficiency.ts'

export * from './modelProvidersEvidenceSufficiency.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const CARDINALITY_TOOLS = new Set(['search_knowledge_catalog', 'get_objects_by_technical_reference'])

type LockedScope = {
  found: boolean
  scope: 'bounded' | 'exhaustive'
  maxItems: number | null
}

const firstDeclaredScope = (items: Array<Record<string, unknown>>): LockedScope => {
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call' || !CARDINALITY_TOOLS.has(String(item?.name || ''))) continue
    const args: any = parse(item.arguments) || {}
    if (!Object.prototype.hasOwnProperty.call(args, 'answerScope')) continue
    const scope = String(args.answerScope || '') === 'exhaustive' ? 'exhaustive' : 'bounded'
    const maxItems = scope === 'exhaustive'
      ? null
      : Math.max(1, Math.min(25, Math.trunc(Number(args.answerMaxItems) || 5)))
    return { found: true, scope, maxItems }
  }
  return { found: false, scope: 'bounded', maxItems: null }
}

const enforceLockedScope = (
  response: NormalizedModelResponse,
  lock: LockedScope,
): NormalizedModelResponse => {
  if (!lock.found) return response
  let rewrites = 0
  const output = (response.output || []).map((item: any) => {
    if (item?.type !== 'function_call' || !CARDINALITY_TOOLS.has(String(item?.name || ''))) return item
    const args: any = parse(item.arguments) || {}
    const currentScope = String(args.answerScope || '') === 'exhaustive' ? 'exhaustive' : 'bounded'
    const currentMax = currentScope === 'exhaustive'
      ? null
      : Math.max(1, Math.min(25, Math.trunc(Number(args.answerMaxItems) || 5)))
    if (currentScope === lock.scope && currentMax === lock.maxItems) return item
    rewrites += 1
    return {
      ...item,
      arguments: JSON.stringify({
        ...args,
        answerScope: lock.scope,
        answerMaxItems: lock.maxItems,
      }),
    }
  })
  if (!rewrites) return response
  return {
    ...response,
    output,
    usage: {
      ...(response.usage || {}),
      deterministic_answer_scope_lock: rewrites,
    },
  }
}

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const lock = firstDeclaredScope(input.items || [])
  const response = await baseRequest(input)
  return enforceLockedScope(response, lock)
}
