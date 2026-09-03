const CUSTOM_TECHNICAL_IDENTIFIER_PATTERN = /(?<![\p{L}\p{N}_])(?:Z[A-Z0-9_]{2,}(?:-\d{2,4})?|CHECK_[A-Z0-9_]+)(?:(?:=>|\/)[A-Z][A-Z0-9_]*)?(?![\p{L}\p{N}_])/gu
const VERIFIED_EVIDENCE_MARKER = 'VERIFIED_KNOWLEDGE_EVIDENCE'
const FENCED_CODE_BLOCK_PATTERN = /```([A-Za-z0-9_+.-]*)[ \t]*\r?\n?([\s\S]*?)```/g

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
const normalizeLiteralSourceLine = (value: string) => String(value || '')
  .toLocaleLowerCase('en-US')
  .replace(/\s+/g, '')

/**
 * When verified enterprise evidence is already present, a fenced source-code
 * line is allowed to survive provider preflight only if that literal line is
 * present in the verified evidence corpus. This mirrors the DB completion
 * provenance invariant early enough to trigger grounded revision instead of a
 * late UNVERIFIED_LITERAL_SOURCE_CODE_LINE transaction failure.
 */
const sanitizeLiteralCodeBlocksAgainstVerifiedEvidence = (
  text: string,
  requestText: string,
): { text: string; removedLines: number; removedIdentifiers: string[] } => {
  const original = String(text || '')
  if (!original.includes('```') || !requestText.includes(VERIFIED_EVIDENCE_MARKER)) {
    return { text: original, removedLines: 0, removedIdentifiers: [] }
  }

  const evidenceCorpus = normalizeLiteralSourceLine(requestText)
  const removedIdentifiers = new Set<string>()
  let removedLines = 0

  const sanitized = original.replace(FENCED_CODE_BLOCK_PATTERN, (_full, rawLanguage: string, rawBody: string) => {
    const language = String(rawLanguage || '')
    const kept: string[] = []
    let removedFromBlock = 0

    for (const rawLine of String(rawBody || '').split(/\r?\n/)) {
      const trimmed = rawLine.trim()
      if (!trimmed || /^\s*["*]/.test(trimmed)) {
        kept.push(rawLine)
        continue
      }

      const normalized = normalizeLiteralSourceLine(trimmed)
      if (normalized.length < 3 || evidenceCorpus.includes(normalized)) {
        kept.push(rawLine)
        continue
      }

      removedFromBlock += 1
      removedLines += 1
      for (const identifier of extractCustomTechnicalIdentifiers(trimmed)) removedIdentifiers.add(identifier)
    }

    if (!removedFromBlock) return _full
    const substantive = kept.some(line => line.trim() && !/^\s*["*]/.test(line.trim()))
    if (!substantive) {
      return 'Doğrulanmış kaynakta birebir karşılığı olmayan literal kod satırları gösterilmedi.'
    }
    return `\`\`\`${language}\n${kept.join('\n').trim()}\n\`\`\``
  })

  return { text: compactLines(sanitized), removedLines, removedIdentifiers: [...removedIdentifiers] }
}

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
 * trusted. If every useful segment would be removed and no verified evidence
 * exists, the original text is kept so the existing fail-closed guard can still
 * block it. With verified evidence present, unsafe text is never restored: a
 * changed draft intentionally triggers the grounded-revision pass.
 */
export const sanitizeNovelCustomIdentifierClaims = (
  text: string,
  requestText: string,
): AnswerabilitySanitization => {
  const original = String(text || '').trim()
  if (!original) return { text: original, removedSegments: 0, removedIdentifiers: [] }

  const hasVerifiedEvidence = requestText.includes(VERIFIED_EVIDENCE_MARKER)
  const literal = sanitizeLiteralCodeBlocksAgainstVerifiedEvidence(original, requestText)
  const supplied = new Set(extractCustomTechnicalIdentifiers(requestText))
  const removed = new Set<string>(literal.removedIdentifiers)
  let removedSegments = literal.removedLines

  const safeLines = literal.text.split(/\r?\n/).flatMap(line => {
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
    if (hasVerifiedEvidence && (removedSegments > 0 || sanitized !== original)) {
      return {
        text: sanitized || 'Doğrulanmamış teknik ayrıntı çıkarıldı. Yanıt doğrulanmış kanıtlarla yeniden oluşturulmalıdır.',
        removedSegments,
        removedIdentifiers: [...removed],
      }
    }
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
