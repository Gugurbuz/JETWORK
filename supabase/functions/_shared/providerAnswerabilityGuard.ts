const CUSTOM_TECHNICAL_IDENTIFIER_PATTERN = /(?<![\p{L}\p{N}_])(?:Z[A-Z0-9_]{2,}(?:-\d{2,4})?|CHECK_[A-Z0-9_]+)(?:(?:=>|\/)[A-Z][A-Z0-9_]*)?(?![\p{L}\p{N}_])/gu

const canonicalIdentifier = (value: string) => value
  .replace(/\s+/g, '')
  .replace(/=>/g, '/')
  .toLocaleUpperCase('en-US')

export const extractCustomTechnicalIdentifiers = (text: string): string[] => {
  const values = new Set<string>()
  for (const match of String(text || '').matchAll(CUSTOM_TECHNICAL_IDENTIFIER_PATTERN)) {
    const value = canonicalIdentifier(match[0])
    if (value) values.add(value)
  }
  return [...values]
}

const compactLines = (value: string) => value
  .split('\n')
  .map(line => line.trimEnd())
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const normalizeMessageNumber = (value: string) => String(Number(value))

/**
 * Batch preflight may preserve an exact SAP message code when the same segment
 * contains mechanically matching ABAP MESSAGE syntax. This is not evidence and
 * does not make the claim trusted; it only avoids deleting a potentially valid
 * segment before the authoritative grounding boundary verifies it against
 * citation-ready knowledge evidence.
 */
const hasSelfConsistentAbapMessageClaim = (segment: string, identifier: string) => {
  const code = identifier.match(/^([A-Z][A-Z0-9_]*)-(\d{2,4})$/)
  if (!code?.[1] || !code?.[2]) return false
  const expectedClass = code[1].toLocaleUpperCase('en-US')
  const expectedNumber = normalizeMessageNumber(code[2])
  for (const match of segment.matchAll(/\bMESSAGE\s+[A-Z]?(\d{2,4})\(([A-Z][A-Z0-9_]*)\)/gi)) {
    const actualNumber = normalizeMessageNumber(String(match[1] || ''))
    const actualClass = String(match[2] || '').toLocaleUpperCase('en-US')
    if (actualClass === expectedClass && actualNumber === expectedNumber) return true
  }
  return false
}

export type AnswerabilitySanitization = {
  text: string
  removedSegments: number
  removedIdentifiers: string[]
}

export type StreamingAnswerabilityStats = {
  emittedSegments: number
  removedSegments: number
  removedIdentifiers: string[]
}

/**
 * Removes only response segments that introduce custom-looking technical
 * identifiers the user did not supply in the current request. This runs before
 * the authoritative grounding boundary; it does not make any identifier
 * trusted. If every useful segment would be removed, the original text is kept
 * so the existing fail-closed guard can still block it.
 */
export const sanitizeNovelCustomIdentifierClaims = (
  text: string,
  requestText: string,
): AnswerabilitySanitization => {
  const original = String(text || '').trim()
  if (!original) return { text: original, removedSegments: 0, removedIdentifiers: [] }

  const supplied = new Set(extractCustomTechnicalIdentifiers(requestText))
  const removed = new Set<string>()
  let removedSegments = 0

  const safeLines = original.split(/\r?\n/).flatMap(line => {
    if (!line.trim()) return ['']
    const segments = line.split(/(?<=[.!?;])\s+/u)
    const kept = segments.filter(segment => {
      const novel = extractCustomTechnicalIdentifiers(segment).filter(identifier => (
        !supplied.has(identifier)
        && !hasSelfConsistentAbapMessageClaim(segment, identifier)
      ))
      if (!novel.length) return true
      novel.forEach(identifier => removed.add(identifier))
      removedSegments += 1
      return false
    })
    return kept.length ? [kept.join(' ')] : []
  })

  const sanitized = compactLines(safeLines.join('\n'))
  if (!sanitized || sanitized.length < 24) {
    return {
      text: original,
      removedSegments,
      removedIdentifiers: [...removed],
    }
  }

  return {
    text: sanitized,
    removedSegments,
    removedIdentifiers: [...removed],
  }
}

const STREAMING_TAIL_GUARD_CHARACTERS = 64
const STREAMING_MAX_PENDING_CHARACTERS = 220

/**
 * Streaming variant of the answerability guard. It never emits an incomplete
 * custom identifier: normal sentence/newline boundaries are flushed eagerly,
 * while long unpunctuated text keeps a safety tail before emitting a chunk.
 * Unlike the batch sanitizer, unsafe streamed segments are never restored — a
 * streamed token cannot be retracted. The downstream authoritative grounding
 * boundary remains the final safety net for the complete provider response.
 */
export const createStreamingProviderAnswerabilityGuard = (input: {
  requestText: string
  onText: (text: string) => void
}) => {
  const supplied = new Set(extractCustomTechnicalIdentifiers(input.requestText))
  const removed = new Set<string>()
  let pending = ''
  let emittedSegments = 0
  let removedSegments = 0

  const emitChecked = (segment: string) => {
    if (!segment) return
    const novel = extractCustomTechnicalIdentifiers(segment).filter(identifier => !supplied.has(identifier))
    if (novel.length) {
      novel.forEach(identifier => removed.add(identifier))
      removedSegments += 1
      return
    }
    emittedSegments += 1
    input.onText(segment)
  }

  const flushCompletedBoundaries = () => {
    const boundary = /(?:\r?\n|[.!?;:](?:[ \t]+|$))/gu
    let consumed = 0
    for (const match of pending.matchAll(boundary)) {
      const end = Number(match.index || 0) + match[0].length
      if (end <= consumed) continue
      emitChecked(pending.slice(consumed, end))
      consumed = end
    }
    if (consumed > 0) pending = pending.slice(consumed)
  }

  const flushLongSafePrefix = () => {
    while (pending.length > STREAMING_MAX_PENDING_CHARACTERS) {
      const target = pending.length - STREAMING_TAIL_GUARD_CHARACTERS
      const prefix = pending.slice(0, target)
      const whitespace = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\t'))
      const cutoff = whitespace > 0 ? whitespace + 1 : target
      emitChecked(pending.slice(0, cutoff))
      pending = pending.slice(cutoff)
    }
  }

  return {
    push(delta: string) {
      if (!delta) return
      pending += delta
      flushCompletedBoundaries()
      flushLongSafePrefix()
    },
    finish() {
      if (pending) {
        emitChecked(pending)
        pending = ''
      }
    },
    stats(): StreamingAnswerabilityStats {
      return {
        emittedSegments,
        removedSegments,
        removedIdentifiers: [...removed],
      }
    },
  }
}
