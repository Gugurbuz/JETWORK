export const OBSERVATION_PREVIEW_MAX_CHARS = 10_000
export const OBSERVATION_READ_MAX_CHARS = 12_000

const clean = (value: unknown, max: number) => String(value ?? '').slice(0, max)

const compactValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    const max = depth <= 1 ? 2_400 : 1_200
    return value.length <= max ? value : `${value.slice(0, max)}\n[...bounded preview...]`
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map(item => compactValue(item, depth + 1))
    if (value.length > items.length) items.push({ _omittedItems: value.length - items.length })
    return items
  }
  if (typeof value === 'object') {
    if (depth >= 5) return '[nested value deferred]'
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Large binary/base64-like payloads never belong in a model observation preview.
      if (/^(data|base64|bytes|binary)$/iu.test(key)) {
        const length = typeof child === 'string' ? child.length : 0
        result[key] = length ? `[binary payload deferred: ${length} chars]` : '[binary payload deferred]'
        continue
      }
      result[key] = compactValue(child, depth + 1)
    }
    return result
  }
  return String(value)
}

const validJsonPreview = (value: unknown, maxChars: number) => {
  const compacted = compactValue(value)
  let text = JSON.stringify(compacted)
  if (text.length <= maxChars) return compacted

  // Second mechanical pass: shrink every string further while preserving keys,
  // canonical identifiers, booleans, counts and array shape.
  const shrink = (item: unknown, depth = 0): unknown => {
    if (typeof item === 'string') return clean(item, depth <= 1 ? 800 : 420)
    if (Array.isArray(item)) return item.slice(0, 6).map(child => shrink(child, depth + 1))
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, child]) => [
        key,
        shrink(child, depth + 1),
      ]))
    }
    return item
  }
  const smaller = shrink(compacted)
  text = JSON.stringify(smaller)
  if (text.length <= maxChars) return smaller

  return {
    previewTruncated: true,
    serializedPrefix: text.slice(0, Math.max(500, maxChars - 300)),
  }
}

export interface CompactObservationEnvelope {
  observationRef: string
  fullCharacters: number
  previewCharacters: number
  truncated: boolean
  preview: unknown
}

export const compactObservation = (
  output: string,
  observationRef: string,
  maxChars = OBSERVATION_PREVIEW_MAX_CHARS,
): CompactObservationEnvelope => {
  const raw = String(output ?? '')
  let parsed: unknown = raw
  try { parsed = JSON.parse(raw) } catch { /* non-JSON tool output remains text */ }

  if (raw.length <= maxChars) {
    return {
      observationRef,
      fullCharacters: raw.length,
      previewCharacters: raw.length,
      truncated: false,
      preview: parsed,
    }
  }

  const preview = validJsonPreview(parsed, maxChars)
  const previewText = typeof preview === 'string' ? preview : JSON.stringify(preview)
  return {
    observationRef,
    fullCharacters: raw.length,
    previewCharacters: previewText.length,
    truncated: true,
    preview,
  }
}

export const readObservationContent = (input: {
  output: string
  mode: 'slice' | 'find'
  query?: string | null
  cursor?: string | null
  offset?: number | null
  maxChars?: number | null
}) => {
  const output = String(input.output ?? '')
  const maxChars = Math.max(500, Math.min(Math.trunc(Number(input.maxChars) || 6_000), OBSERVATION_READ_MAX_CHARS))
  const cursorOffset = (() => {
    const raw = String(input.cursor || '').trim()
    const match = raw.match(/^obs:(\d+)$/u)
    return match?.[1] ? Math.max(0, Number(match[1]) || 0) : null
  })()

  if (input.mode === 'find') {
    const query = String(input.query || '').trim()
    if (!query) return { ok: false, error: 'QUERY_REQUIRED_FOR_FIND' as const }
    const index = output.toLocaleLowerCase('tr-TR').indexOf(query.toLocaleLowerCase('tr-TR'))
    if (index < 0) return { ok: true, mode: 'find' as const, query, found: false, fullCharacters: output.length, text: '' }
    const start = Math.max(0, index - Math.floor(maxChars * 0.25))
    const text = output.slice(start, start + maxChars)
    const hasMoreBefore = start > 0
    const hasMoreAfter = start + text.length < output.length
    return {
      ok: true,
      mode: 'find' as const,
      query,
      found: true,
      matchOffset: index,
      returnedOffset: start,
      fullCharacters: output.length,
      hasMoreBefore,
      hasMoreAfter,
      previousCursor: hasMoreBefore ? `obs:${Math.max(0, start - maxChars)}` : null,
      nextCursor: hasMoreAfter ? `obs:${start + text.length}` : null,
      windowCharacters: maxChars,
      text,
    }
  }

  const requestedOffset = cursorOffset ?? Math.trunc(Number(input.offset) || 0)
  const offset = Math.max(0, Math.min(requestedOffset, output.length))
  const text = output.slice(offset, offset + maxChars)
  const hasMoreBefore = offset > 0
  const hasMoreAfter = offset + text.length < output.length
  return {
    ok: true,
    mode: 'slice' as const,
    returnedOffset: offset,
    fullCharacters: output.length,
    hasMoreBefore,
    hasMoreAfter,
    previousCursor: hasMoreBefore ? `obs:${Math.max(0, offset - maxChars)}` : null,
    nextCursor: hasMoreAfter ? `obs:${offset + text.length}` : null,
    windowCharacters: maxChars,
    text,
  }
}
