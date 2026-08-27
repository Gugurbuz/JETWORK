const STRUCTURED_TECHNICAL_IDENTIFIER = /\b(?:Z[A-Za-z0-9_]{2,}(?:[-_/][A-Za-z0-9_]+)+|Z[A-Za-z_]*\d[A-Za-z0-9_/-]*|CHECK_[A-Za-z0-9_]+|NINJA_[A-Za-z0-9_]+|[A-Z][A-Z0-9_]{2,}-\d{2,4})\b/u
const PLAIN_UPPERCASE_Z_IDENTIFIER = /\bZ[A-Z]{2,8}\b/u

export const hasExactTechnicalIdentifier = (value: string): boolean => (
  STRUCTURED_TECHNICAL_IDENTIFIER.test(value)
  || PLAIN_UPPERCASE_Z_IDENTIFIER.test(value)
)

export const extractExactTechnicalIdentifiers = (value: string, limit = 10): string[] => {
  const structured = value.match(new RegExp(STRUCTURED_TECHNICAL_IDENTIFIER.source, 'gu')) || []
  const plainUppercase = value.match(new RegExp(PLAIN_UPPERCASE_Z_IDENTIFIER.source, 'gu')) || []
  return [...new Set([...structured, ...plainUppercase].map(item => item.toLocaleUpperCase('en-US')))].slice(0, limit)
}
