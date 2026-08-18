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

export type AnswerabilitySanitization = {
  text: string
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
      const novel = extractCustomTechnicalIdentifiers(segment).filter(identifier => !supplied.has(identifier))
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
