import {
  requestGeminiResponse as baseRequest,
  type NormalizedModelResponse,
} from './modelProvidersEvidenceSufficiency.ts'

export * from './modelProvidersEvidenceSufficiency.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const CARDINALITY_TOOLS = new Set([
  'search_knowledge_catalog',
  'get_objects_by_technical_reference',
])

type LockedMaxItems = { found: boolean; value: number | null }

const firstDeclaredMaxItems = (items: Array<Record<string, unknown>>): LockedMaxItems => {
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call') continue
    if (!CARDINALITY_TOOLS.has(String(item?.name || ''))) continue
    const args: any = parse(item.arguments) || {}
    if (!Object.prototype.hasOwnProperty.call(args, 'maxItems')) continue
    const raw = args.maxItems
    if (raw == null) return { found: true, value: null }
    const value = Math.max(1, Math.min(25, Math.trunc(Number(raw) || 1)))
    return { found: true, value }
  }
  return { found: false, value: null }
}

const enforceLockedMaxItems = (
  response: NormalizedModelResponse,
  lock: LockedMaxItems,
): NormalizedModelResponse => {
  if (!lock.found) return response
  let rewrites = 0
  const output = (response.output || []).map((item: any) => {
    if (item?.type !== 'function_call' || !CARDINALITY_TOOLS.has(String(item?.name || ''))) return item
    const args: any = parse(item.arguments) || {}
    const current = Object.prototype.hasOwnProperty.call(args, 'maxItems') ? args.maxItems : undefined
    const normalizedCurrent = current == null ? null : Math.max(1, Math.min(25, Math.trunc(Number(current) || 1)))
    if (current !== undefined && normalizedCurrent === lock.value) return item
    rewrites += 1
    return {
      ...item,
      arguments: JSON.stringify({ ...args, maxItems: lock.value }),
    }
  })
  if (!rewrites) return response
  return {
    ...response,
    output,
    usage: {
      ...(response.usage || {}),
      deterministic_max_items_lock: rewrites,
    },
  }
}

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const lock = firstDeclaredMaxItems(input.items || [])
  const response = await baseRequest(input)
  return enforceLockedMaxItems(response, lock)
}
