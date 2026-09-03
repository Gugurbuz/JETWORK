const VERIFIED_EVIDENCE_MARKER = 'VERIFIED_KNOWLEDGE_EVIDENCE'

const parseVerifiedToolOutput = (value: unknown): string => {
  const output = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  if (!output.trim()) return ''
  try {
    const parsed = JSON.parse(output)
    if (
      parsed?.citationReady === true
      && String(parsed?.securityNotice || '').includes(VERIFIED_EVIDENCE_MARKER)
    ) return output
  } catch { /* ignore malformed output */ }
  return ''
}

const derivedAbapMessageCodes = (value: string) => {
  const codes = new Set<string>()
  for (const match of value.matchAll(/\bMESSAGE\s+[A-Z]?(\d{2,4})\(([A-Z][A-Z0-9_]*)\)/gi)) {
    const number = String(match[1] || '')
    const messageClass = String(match[2] || '').toLocaleUpperCase('en-US')
    if (number && messageClass) codes.add(`${messageClass}-${number}`)
  }
  return [...codes]
}

export const verifiedToolEvidenceForAnswerability = (items: Array<Record<string, unknown>>) => {
  const chunks: string[] = []
  for (const item of items) {
    if (String(item.type || '') !== 'function_call_output') continue
    const output = parseVerifiedToolOutput(item.output)
    if (!output) continue
    const derived = derivedAbapMessageCodes(output)
    chunks.push(output.toLocaleUpperCase('en-US'))
    if (derived.length) chunks.push(derived.join(' '))
  }
  return chunks.join('\n').slice(0, 28_000)
}
