export interface GroundingSourceLike {
  canonicalKey?: string
  objectType?: string
  title?: string
  sourceId?: string
  sourceType?: string
  url?: string
}

export interface GroundingToolResultLike {
  output: string
  sources: GroundingSourceLike[]
  summary: Record<string, unknown>
}

export interface GroundingPlanLike {
  knowledgeRequired?: boolean
}

export interface GroundingCoverageResult {
  ok: boolean
  verifiedKnowledgeEvidence: boolean
  unsupportedIdentifiers: string[]
  messageTextMismatches: Array<{ identifier: string; claimed: string; expected: string }>
}

const clean = (value: unknown, max = 20_000) => String(value ?? '').trim().slice(0, max)
const normalizeText = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[`*_"'“”‘’]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const stripMessageDecorators = (value: string) => value
  .replace(/^\s*[A-Z][A-Z0-9_]{2,}-\d{2,4}\s*(?:—|–|-|:)\s*/i, '')
  .replace(/\s*·\s*Metotlar:\s*[\s\S]*$/i, '')
  .trim()

const canonicalIdentifier = (value: string) => {
  const raw = clean(value, 360)
  if (!raw) return ''
  const canonical = raw.match(/^([a-z_]+):(.+)$/i)
  if (canonical) return canonicalIdentifier(canonical[2])
  return raw
    .replace(/\s+/g, '')
    .replace(/=>/g, '/')
    .toLocaleUpperCase('en-US')
}

const TECHNICAL_IDENTIFIER_PATTERN = /\b(?:Z[A-Z0-9_]{2,}(?:-\d{2,4})?|CHECK_[A-Z0-9_]+)(?:(?:=>|\/)[A-Z][A-Z0-9_]*)?\b/g
const CANONICAL_KEY_PATTERN = /\b(?:message|class|method|function|table|interface|document|business_rule):[a-z0-9_./-]+\b/gi
const MESSAGE_CODE_PATTERN = /\b[A-Z][A-Z0-9_]{2,}-\d{2,4}\b/g

export const extractTechnicalIdentifiers = (text: string): string[] => {
  const values = new Set<string>()
  const add = (value: string) => {
    const normalized = canonicalIdentifier(value)
    if (normalized) values.add(normalized)
  }
  for (const match of clean(text).matchAll(TECHNICAL_IDENTIFIER_PATTERN)) add(match[0])
  for (const match of clean(text).matchAll(CANONICAL_KEY_PATTERN)) add(match[0])
  return [...values]
}

export const resultHasVerifiedKnowledgeEvidence = (result: GroundingToolResultLike) => (
  result.summary?.citationReady === true
  && result.sources.some(source => Boolean(clean(source.canonicalKey, 320) || clean(source.sourceId, 120)))
)

const parsedVerifiedRecords = (result: GroundingToolResultLike): Array<Record<string, unknown>> => {
  if (!resultHasVerifiedKnowledgeEvidence(result)) return []
  try {
    const parsed = JSON.parse(result.output)
    const records = parsed?.records
    if (Array.isArray(records)) return records.filter((item: unknown) => item && typeof item === 'object')
    if (records && typeof records === 'object') {
      const nested = records as Record<string, unknown>
      const values: Array<Record<string, unknown>> = []
      if (Array.isArray(nested.items)) values.push(...nested.items.filter((item: unknown) => item && typeof item === 'object') as Array<Record<string, unknown>>)
      if (Array.isArray(nested.objects)) values.push(...nested.objects.filter((item: unknown) => item && typeof item === 'object') as Array<Record<string, unknown>>)
      return values
    }
    return []
  } catch {
    return []
  }
}

const verifiedIdentifierSet = (sources: GroundingSourceLike[], toolResults: GroundingToolResultLike[]) => {
  const supported = new Set<string>()
  const addText = (value: unknown) => {
    for (const identifier of extractTechnicalIdentifiers(clean(value))) supported.add(identifier)
  }
  for (const source of sources) {
    if (source.sourceType === 'web') continue
    addText(source.canonicalKey)
  }
  for (const result of toolResults) {
    if (!resultHasVerifiedKnowledgeEvidence(result)) continue
    for (const source of result.sources) addText(source.canonicalKey)
    // Technical identifiers inside citation-ready exact/detail/list records are
    // themselves authoritative evidence. Candidate search output never enters here.
    for (const record of parsedVerifiedRecords(result)) {
      addText(record.canonicalKey)
      addText(record.name)
      addText(record.title)
      addText(record.summary)
      addText(record.content)
    }
    try {
      const parsed = JSON.parse(result.output)
      if (parsed?.records?.relations && Array.isArray(parsed.records.relations)) {
        for (const relation of parsed.records.relations) {
          if (!relation || typeof relation !== 'object') continue
          addText((relation as Record<string, unknown>).sourceCanonicalKey)
          addText((relation as Record<string, unknown>).targetCanonicalKey)
        }
      }
    } catch { /* ignore malformed output */ }
  }
  return supported
}

const messageTitleMap = (sources: GroundingSourceLike[], toolResults: GroundingToolResultLike[]) => {
  const titles = new Map<string, string>()
  const put = (canonicalKey: unknown, objectType: unknown, title: unknown) => {
    const type = clean(objectType, 40).toLocaleLowerCase('en-US')
    const key = canonicalIdentifier(clean(canonicalKey, 320))
    const safeTitle = stripMessageDecorators(clean(title, 2_000))
    if (!key || !safeTitle) return
    if (type === 'message' || /^[A-Z][A-Z0-9_]{2,}-\d{2,4}$/.test(key)) titles.set(key, safeTitle)
  }
  for (const source of sources) put(source.canonicalKey, source.objectType, source.title)
  for (const result of toolResults) {
    for (const record of parsedVerifiedRecords(result)) put(record.canonicalKey, record.objectType, record.title)
  }
  return titles
}

const exactMessageClaims = (text: string): Array<{ identifier: string; claimed: string }> => {
  const lines = clean(text).split(/\r?\n/)
  const claims: Array<{ identifier: string; claimed: string }> = []
  let activeMessage = ''
  for (const line of lines) {
    const code = line.toLocaleUpperCase('en-US').match(MESSAGE_CODE_PATTERN)?.[0]
    if (code) activeMessage = canonicalIdentifier(code)
    const labeled = line.match(/(?:Mesaj\s*Metni|Message\s*Text)\s*:\s*(.+)$/iu)
    if (labeled?.[1] && activeMessage) {
      claims.push({ identifier: activeMessage, claimed: stripMessageDecorators(labeled[1]) })
      continue
    }
    const inline = line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?([A-Z][A-Z0-9_]{2,}-\d{2,4})(?:\*\*)?\s*(?:—|–|:)\s*(.+)$/)
    if (inline?.[1] && inline?.[2]) {
      claims.push({ identifier: canonicalIdentifier(inline[1]), claimed: stripMessageDecorators(inline[2]) })
    }
  }
  return claims
}

const sameExactMessage = (claimed: string, expected: string) => {
  const left = normalizeText(stripMessageDecorators(claimed))
  const right = normalizeText(stripMessageDecorators(expected))
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)))
}

export const evaluateGroundedTechnicalClaims = (input: {
  text: string
  plan: GroundingPlanLike
  sources: GroundingSourceLike[]
  toolResults: GroundingToolResultLike[]
}): GroundingCoverageResult => {
  if (!input.plan.knowledgeRequired) {
    return { ok: true, verifiedKnowledgeEvidence: false, unsupportedIdentifiers: [], messageTextMismatches: [] }
  }
  const verifiedResults = input.toolResults.filter(resultHasVerifiedKnowledgeEvidence)
  const verifiedKnowledgeEvidence = verifiedResults.length > 0 || input.sources.some(source => (
    source.sourceType !== 'web' && Boolean(clean(source.canonicalKey, 320) || clean(source.sourceId, 120))
  ))
  const verifiedWebEvidence = input.sources.some(source => (
    source.sourceType === 'web' && /^https?:\/\//i.test(clean(source.url, 2_000))
  ))
  const supported = verifiedIdentifierSet(input.sources, verifiedResults)
  const responseIdentifiers = extractTechnicalIdentifiers(input.text)
  const unsupportedIdentifiers = responseIdentifiers.filter(identifier => !supported.has(identifier))

  const titles = messageTitleMap(input.sources, verifiedResults)
  const messageTextMismatches = exactMessageClaims(input.text).flatMap(claim => {
    const expected = titles.get(claim.identifier)
    if (!expected || sameExactMessage(claim.claimed, expected)) return []
    return [{ identifier: claim.identifier, claimed: claim.claimed, expected }]
  })

  const requiresKnowledgeIdentifierCoverage = responseIdentifiers.length > 0 || messageTextMismatches.length > 0
  return {
    ok: (requiresKnowledgeIdentifierCoverage ? verifiedKnowledgeEvidence : (verifiedKnowledgeEvidence || verifiedWebEvidence))
      && unsupportedIdentifiers.length === 0
      && messageTextMismatches.length === 0,
    verifiedKnowledgeEvidence,
    unsupportedIdentifiers,
    messageTextMismatches,
  }
}

export const shouldFailClosedGroundedAnswer = (input: {
  plan: GroundingPlanLike
  coverage: GroundingCoverageResult
}) => Boolean(input.plan.knowledgeRequired && !input.coverage.ok)

export const groundingFailureText = () => (
  'Bu teknik yanıtı güvenli biçimde tamamlayamadım: üretilen taslakta doğrulanmış kurumsal kanıtın kapsamadığı teknik ayrıntılar vardı. Yanlış mesaj, metot, sınıf veya kod uydurmamak için bu ayrıntıları göstermiyorum.'
)
