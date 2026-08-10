export type EnumerationFastPathTool = 'list_knowledge_catalog' | 'list_class_inventory'

export interface EnumerationFastPathDispatch {
  toolName: EnumerationFastPathTool
  arguments: Record<string, unknown>
}

const SEMANTIC_PLAN_PATTERN = /\[JETWORK_SEMANTIC_PLAN\]\s*([\s\S]*?)\s*\[END_JETWORK_SEMANTIC_PLAN\]/i
export const OPENAI_ENUMERATION_FAST_PATH_START = '[JETWORK_ENUMERATION_FAST_PATH]'
export const OPENAI_ENUMERATION_FAST_PATH_END = '[END_JETWORK_ENUMERATION_FAST_PATH]'

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const candidate = part as Record<string, unknown>
    return typeof candidate.text === 'string' ? candidate.text : ''
  }).filter(Boolean).join('\n')
}

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const normalizeIdentifier = (value: unknown) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z0-9]+/g, '')

const targetFromItems = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = textFromContent(items[index].content)
    if (!text) continue
    const match = text.match(SEMANTIC_PLAN_PATTERN)
    if (!match?.[1]) continue
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>
      const rawTarget = parsed?.enumerationTarget
      if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) return null
      const target = rawTarget as Record<string, unknown>
      const tool = String(target.tool || '') as EnumerationFastPathTool
      if (!['list_knowledge_catalog', 'list_class_inventory'].includes(tool)) return null
      return {
        tool,
        objectType: target.objectType == null ? null : String(target.objectType || '').trim() || null,
        prefix: target.prefix == null ? null : String(target.prefix || '').trim() || null,
      }
    } catch {
      return null
    }
  }
  return null
}

const sameCatalogFilter = (
  args: Record<string, unknown>,
  target: { objectType: string | null; prefix: string | null },
) => (
  String(args.objectType || '').trim().toLocaleLowerCase('en-US') === String(target.objectType || '').trim().toLocaleLowerCase('en-US')
  && normalizeIdentifier(args.prefix) === normalizeIdentifier(target.prefix)
)

const latestMatchingCatalogOutput = (
  items: Array<Record<string, unknown>>,
  target: { objectType: string | null; prefix: string | null },
) => {
  const matchingCalls = new Map<string, Record<string, unknown>>()
  let latest: Record<string, unknown> | null = null

  for (const item of items) {
    const type = String(item.type || '')
    if (type === 'function_call' && String(item.name || '') === 'list_knowledge_catalog') {
      const args = parseJsonObject(item.arguments) || {}
      if (sameCatalogFilter(args, target)) matchingCalls.set(String(item.call_id || ''), args)
      continue
    }
    if (type !== 'function_call_output') continue
    const callId = String(item.call_id || '')
    if (!matchingCalls.has(callId)) continue
    const parsed = parseJsonObject(item.output)
    if (!parsed || String(parsed.tool || '') !== 'list_knowledge_catalog') return null
    const records = parsed.records && typeof parsed.records === 'object' && !Array.isArray(parsed.records)
      ? parsed.records as Record<string, unknown>
      : null
    if (!records) return null
    latest = records
  }

  return {
    hasMatchingCall: matchingCalls.size > 0,
    records: latest,
  }
}

export const buildEnumerationFastPathDispatch = (
  items: Array<Record<string, unknown>>,
): EnumerationFastPathDispatch | null => {
  const target = targetFromItems(items)
  if (!target) return null

  if (target.tool === 'list_class_inventory') {
    const alreadyCalled = items.some(item => (
      String(item.type || '') === 'function_call'
      && String(item.name || '') === 'list_class_inventory'
    ))
    if (alreadyCalled) return null
    return { toolName: 'list_class_inventory', arguments: {} }
  }

  const latest = latestMatchingCatalogOutput(items, target)
  if (!latest.hasMatchingCall) {
    return {
      toolName: 'list_knowledge_catalog',
      arguments: {
        objectType: target.objectType,
        prefix: target.prefix,
        cursor: null,
        limit: 25,
      },
    }
  }

  if (!latest.records) return null
  const nextCursor = String(latest.records.nextCursor || '').trim()
  if (!nextCursor) return null
  return {
    toolName: 'list_knowledge_catalog',
    arguments: {
      objectType: target.objectType,
      prefix: target.prefix,
      cursor: nextCursor,
      limit: 25,
    },
  }
}

export const buildSyntheticEnumerationFunctionCall = (
  dispatch: EnumerationFastPathDispatch,
  callId = `enum-fast:${crypto.randomUUID()}`,
) => ({
  type: 'function_call',
  name: dispatch.toolName,
  call_id: callId,
  arguments: JSON.stringify(dispatch.arguments),
})

export const buildOpenAiEnumerationFastPathMarkerItem = (
  dispatch: EnumerationFastPathDispatch,
) => ({
  role: 'developer',
  content: `${OPENAI_ENUMERATION_FAST_PATH_START}${JSON.stringify(dispatch)}${OPENAI_ENUMERATION_FAST_PATH_END}`,
})

export const extractOpenAiEnumerationFastPathDispatch = (
  requestBody: unknown,
): EnumerationFastPathDispatch | null => {
  const body = requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
    ? requestBody as Record<string, unknown>
    : null
  const input = Array.isArray(body?.input) ? body.input as Array<Record<string, unknown>> : []
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const text = textFromContent(input[index].content)
    if (!text.includes(OPENAI_ENUMERATION_FAST_PATH_START)) continue
    const start = text.indexOf(OPENAI_ENUMERATION_FAST_PATH_START) + OPENAI_ENUMERATION_FAST_PATH_START.length
    const end = text.indexOf(OPENAI_ENUMERATION_FAST_PATH_END, start)
    if (end < start) return null
    const parsed = parseJsonObject(text.slice(start, end))
    if (!parsed) return null
    const toolName = String(parsed.toolName || '') as EnumerationFastPathTool
    if (!['list_knowledge_catalog', 'list_class_inventory'].includes(toolName)) return null
    const args = parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
      ? parsed.arguments as Record<string, unknown>
      : {}
    return { toolName, arguments: args }
  }
  return null
}

export const buildOpenAiEnumerationFastPathResponse = (
  requestBody: unknown,
): Response | null => {
  const dispatch = extractOpenAiEnumerationFastPathDispatch(requestBody)
  if (!dispatch) return null
  const body = requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
    ? requestBody as Record<string, unknown>
    : {}
  const model = String(body.model || 'gpt-5.6-sol')
  const response = {
    id: `jetwork-enum-fast:${crypto.randomUUID()}`,
    status: 'completed',
    model,
    output: [buildSyntheticEnumerationFunctionCall(dispatch)],
    usage: {
      deterministic_enumeration_dispatch: 1,
      deterministic_provider_calls_avoided: 1,
    },
  }
  const payload = `data: ${JSON.stringify({ type: 'response.completed', response })}\n\ndata: [DONE]\n\n`
  return new Response(payload, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
