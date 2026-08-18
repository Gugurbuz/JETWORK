const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const parseArguments = (value: unknown): Record<string, unknown> => parseRecord(value) || {}

const normalizeIdentifier = (value: unknown) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('en-US')

const isEmptyKnowledgeOutput = (value: unknown): boolean => {
  const parsed = parseRecord(value)
  if (!parsed) return false
  if (Array.isArray(parsed.records)) return parsed.records.length === 0
  const summary = parsed.summary && typeof parsed.summary === 'object' && !Array.isArray(parsed.summary)
    ? parsed.summary as Record<string, unknown>
    : undefined
  const rawCount = parsed.resultCount ?? summary?.resultCount
  return rawCount !== undefined && Number(rawCount) === 0
}

type ToolCall = {
  name: string
  arguments: Record<string, unknown>
}

export type EmptyExactIdentifierPair = {
  identifier: string
  lookupTool: 'get_message_detail'
}

const collectToolState = (items: Array<Record<string, unknown>>) => {
  const calls = new Map<string, ToolCall>()
  const emptyMessageCodes = new Map<string, string>()
  const exactCatalogQueries = new Set<string>()
  const emptyCatalogQueries = new Set<string>()

  for (const item of items) {
    const type = String(item.type || '')
    const callId = String(item.call_id || '')
    if (type === 'function_call') {
      const call = {
        name: String(item.name || ''),
        arguments: parseArguments(item.arguments),
      }
      calls.set(callId, call)
      if (call.name === 'search_knowledge_catalog') {
        const normalized = normalizeIdentifier(call.arguments.query)
        if (normalized) exactCatalogQueries.add(normalized)
      }
      continue
    }
    if (type !== 'function_call_output' || !isEmptyKnowledgeOutput(item.output)) continue

    const call = calls.get(callId)
    if (!call) continue
    if (call.name === 'get_message_detail') {
      const original = String(call.arguments.messageCode ?? '').trim()
      const normalized = normalizeIdentifier(original)
      if (normalized) emptyMessageCodes.set(normalized, original)
    }
    if (call.name === 'search_knowledge_catalog') {
      const normalized = normalizeIdentifier(call.arguments.query)
      if (normalized) emptyCatalogQueries.add(normalized)
    }
  }

  return { emptyMessageCodes, exactCatalogQueries, emptyCatalogQueries }
}

export const hasEmptyMessageDetailLookup = (items: Array<Record<string, unknown>>): boolean => (
  collectToolState(items).emptyMessageCodes.size > 0
)

export const findEmptyMessageDetailNeedingCatalogCheck = (
  items: Array<Record<string, unknown>>,
): EmptyExactIdentifierPair | null => {
  const { emptyMessageCodes, exactCatalogQueries } = collectToolState(items)
  for (const [normalized, identifier] of emptyMessageCodes) {
    if (!exactCatalogQueries.has(normalized)) {
      return { identifier, lookupTool: 'get_message_detail' }
    }
  }
  return null
}

export const findEmptyExactIdentifierPair = (
  items: Array<Record<string, unknown>>,
): EmptyExactIdentifierPair | null => {
  const { emptyMessageCodes, emptyCatalogQueries } = collectToolState(items)
  for (const [normalized, identifier] of emptyMessageCodes) {
    if (emptyCatalogQueries.has(normalized)) {
      return { identifier, lookupTool: 'get_message_detail' }
    }
  }
  return null
}
