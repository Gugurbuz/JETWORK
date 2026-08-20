export interface AcronymSanitizationResult {
  text: string
  removed: number
}

const normalizeForEvidence = (value: string) => String(value || '')
  .replace(/[\*_`]/gu, '')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLocaleLowerCase('tr-TR')

const supportedByEvidence = (evidence: string, acronym: string, expansion: string) => {
  const normalizedEvidence = normalizeForEvidence(evidence)
  const normalizedClaim = normalizeForEvidence(`${acronym} (${expansion})`)
  return Boolean(normalizedClaim) && normalizedEvidence.includes(normalizedClaim)
}

type StyledReplacement = (acronym: string) => string

const stripUnsupported = (
  text: string,
  evidence: string,
  pattern: RegExp,
  replacement: StyledReplacement,
) => {
  let removed = 0
  const next = text.replace(pattern, (full, acronym: string, expansion: string) => {
    if (supportedByEvidence(evidence, acronym, expansion)) return full
    removed += 1
    return replacement(acronym)
  })
  return { text: next, removed }
}

/**
 * Exact enterprise answers may preserve an acronym only when its expansion is
 * present in authoritative evidence. Models frequently wrap the acronym in
 * Markdown before adding a parenthetical expansion, so every common inline
 * Markdown form must be checked instead of relying on the plain-text shape.
 */
export const sanitizeUnsupportedAcronymExpansions = (
  text: string,
  evidence: string,
): AcronymSanitizationResult => {
  let current = String(text || '')
  let removed = 0

  const passes: Array<[RegExp, StyledReplacement]> = [
    [/\*\*([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ_/-]{2,})\*\*\s*\(([^)\n]{2,120})\)/gu, acronym => `**${acronym}**`],
    [/__([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ_/-]{2,})__\s*\(([^)\n]{2,120})\)/gu, acronym => `__${acronym}__`],
    [/`([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ_/-]{2,})`\s*\(([^)\n]{2,120})\)/gu, acronym => `\`${acronym}\``],
    [/\*([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ_/-]{2,})\*\s*\(([^)\n]{2,120})\)/gu, acronym => `*${acronym}*`],
    [/_([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ_/-]{2,})_\s*\(([^)\n]{2,120})\)/gu, acronym => `_${acronym}_`],
    [/\b([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ_/-]{2,})\b\s*\(([^)\n]{2,120})\)/gu, acronym => acronym],
  ]

  for (const [pattern, replacement] of passes) {
    const result = stripUnsupported(current, evidence, pattern, replacement)
    current = result.text
    removed += result.removed
  }

  return { text: current, removed }
}
