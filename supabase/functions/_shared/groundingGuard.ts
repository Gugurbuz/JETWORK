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
  enterpriseGroundingRequired?: boolean
  goal?: string
  conversationState?: {
    resolvedRequest?: string
  }
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

// ASCII-looking SAP identifiers can appear inside Turkish words when \b treats
// letters such as Ö/Ş as non-word characters (for example SÖZLEŞME -> ZLE).
// Unicode letter/number guards make sure an identifier is a standalone token.
const TECHNICAL_IDENTIFIER_PATTERN = /(?<![\p{L}\p{N}_])(?:Z[A-Z0-9_]{2,}(?:-\d{2,4})?|CHECK_[A-Z0-9_]+)(?:(?:=>|\/)[A-Z][A-Z0-9_]*)?(?![\p{L}\p{N}_])/gu
const CANONICAL_KEY_PATTERN = /\b(?:message|class|method|function|table|interface|document|business_rule):[a-z0-9_./-]+\b/gi
const MESSAGE_CODE_PATTERN = /\b[A-Z][A-Z0-9_]{2,}-\d{2,4}\b/g
const EVIDENCE_GAP_PATTERN = /(?:dogrulan(?:mis|abilir)\s+(?:bir\s+)?(?:kayit|kaynak|bilgi|kanit)\s+bulamad\w*|dogrulayamad\w*|teyit\s+edemed\w*|yeterli\s+(?:guvenilir\s+)?(?:kayit|kaynak|bilgi|kanit)\s+(?:yok|bulunmuyor|bulamad\w*)|kesin\s+(?:olarak\s+)?soyleyemem|mevcut\s+(?:kayit|kaynak|bilgi|kanit)(?:larda|ta|te)?\s+.*(?:yok|bulunmuyor|yer\s+almiyor)|could\s+not\s+verify|couldn'?t\s+verify|no\s+verified\s+(?:record|source|evidence|information)|insufficient\s+(?:reliable\s+)?(?:evidence|information))/i
const EVIDENCE_GAP_CONTRADICTION_PATTERN = /\b(?:ama|ancak|fakat|buna\s+ragmen|however|but|nevertheless)\b/i

export const enterpriseGroundingRequiredForPlan = (plan: GroundingPlanLike): boolean => (
  typeof plan.enterpriseGroundingRequired === 'boolean'
    ? plan.enterpriseGroundingRequired
    : plan.knowledgeRequired === true
)

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

const suppliedRequestText = (plan: GroundingPlanLike) => [
  clean(plan.goal, 32_000),
  clean(plan.conversationState?.resolvedRequest, 32_000),
].filter(Boolean).join('\n')

// A user may mention an enterprise identifier while supplying a requirement; that
// alone is not authoritative evidence. Exact fact lookups (messages, errors,
// behavior, conditions, call locations) must still be verified at the response
// boundary even if semantic planning left enterpriseGroundingRequired=false.
const EXACT_TECHNICAL_FACT_REQUEST_PATTERN = /(?:hangi\s+(?:mesaj(?:lar)?|hata(?:lar)?|tablo(?:lar)?|alan(?:lar)?|metot(?:lar)?|method(?:s)?|class(?:es)?|function(?:s)?)|hangi\s+kosul(?:da|larda)?|ne\s+(?:yapar|yapiyor|uretir|dondurur|kontrol\s+eder)|nerede\s+(?:kullanilir|cagrilir)|what\s+(?:messages?|errors?|tables?|fields?|methods?|functions?)|which\s+(?:messages?|errors?|tables?|fields?|methods?|functions?)|what\s+does|how\s+does)/i

const exactTechnicalFactLookupRequested = (text: string, identifiers: Set<string>) => (
  identifiers.size > 0 && EXACT_TECHNICAL_FACT_REQUEST_PATTERN.test(normalizeText(text))
)

const evidenceGapIdentifiers = (text: string) => {
  const identifiers = new Set<string>()
  const segments = clean(text).split(/(?:\r?\n)+|(?<=[.!?])\s+/)
  for (const segment of segments) {
    const normalized = normalizeText(segment)
    if (!normalized || !EVIDENCE_GAP_PATTERN.test(normalized) || EVIDENCE_GAP_CONTRADICTION_PATTERN.test(normalized)) continue
    for (const identifier of extractTechnicalIdentifiers(segment)) identifiers.add(identifier)
  }
  return identifiers
}

const isEvidenceGapResponse = (text: string) => {
  const normalized = normalizeText(text)
  return Boolean(normalized && EVIDENCE_GAP_PATTERN.test(normalized) && !EVIDENCE_GAP_CONTRADICTION_PATTERN.test(normalized))
}

export const resultHasVerifiedKnowledgeEvidence = (result: GroundingToolResultLike) => (
  result.summary?.citationReady === true
  && result.sources.some(source => (
    source.sourceType !== 'web'
    && Boolean(clean(source.canonicalKey, 320) || clean(source.sourceId, 120))
  ))
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
    for (const source of result.sources) {
      if (source.sourceType === 'web') continue
      addText(source.canonicalKey)
    }
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
  for (const source of sources) {
    if (source.sourceType === 'web') continue
    put(source.canonicalKey, source.objectType, source.title)
  }
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

const suppliedExactClaim = (
  claim: { identifier: string; claimed: string },
  suppliedClaims: Array<{ identifier: string; claimed: string }>,
) => suppliedClaims.some(supplied => (
  supplied.identifier === claim.identifier && sameExactMessage(claim.claimed, supplied.claimed)
))

export const evaluateGroundedTechnicalClaims = (input: {
  text: string
  plan: GroundingPlanLike
  sources: GroundingSourceLike[]
  toolResults: GroundingToolResultLike[]
  currentUserText?: string
}): GroundingCoverageResult => {
  const responseIdentifiers = extractTechnicalIdentifiers(input.text)
  const suppliedText = clean(input.currentUserText, 32_000) || suppliedRequestText(input.plan)
  const suppliedIdentifiers = new Set(extractTechnicalIdentifiers(suppliedText))
  const responseMessageClaims = exactMessageClaims(input.text)
  const suppliedMessageClaims = exactMessageClaims(suppliedText)
  const novelResponseIdentifiers = responseIdentifiers.filter(identifier => !suppliedIdentifiers.has(identifier))
  const novelExactMessageClaims = responseMessageClaims.filter(claim => !suppliedExactClaim(claim, suppliedMessageClaims))
  const explicitEnterpriseGrounding = enterpriseGroundingRequiredForPlan(input.plan)
  const exactTechnicalFactLookup = exactTechnicalFactLookupRequested(suppliedText, suppliedIdentifiers)
  const userSuppliedRequirementsMayCountAsEvidence = !explicitEnterpriseGrounding && !exactTechnicalFactLookup

  // User-supplied requirements may be analysed without an unrelated knowledge
  // lookup, but an explicit strict plan or an exact technical fact lookup must
  // be backed by verified enterprise evidence. The identifier appearing in the
  // user's question is context, not proof of the answer.
  const strictEnterpriseClaim = explicitEnterpriseGrounding
    || exactTechnicalFactLookup
    || novelResponseIdentifiers.length > 0
    || novelExactMessageClaims.length > 0
  if (!strictEnterpriseClaim) {
    return { ok: true, verifiedKnowledgeEvidence: false, unsupportedIdentifiers: [], messageTextMismatches: [] }
  }

  const verifiedResults = input.toolResults.filter(resultHasVerifiedKnowledgeEvidence)
  const verifiedKnowledgeEvidence = verifiedResults.length > 0 || input.sources.some(source => (
    source.sourceType !== 'web' && Boolean(clean(source.canonicalKey, 320) || clean(source.sourceId, 120))
  ))
  const supported = verifiedIdentifierSet(input.sources, verifiedResults)
  if (userSuppliedRequirementsMayCountAsEvidence) {
    for (const identifier of suppliedIdentifiers) supported.add(identifier)
  }

  const safeGapIdentifiers = evidenceGapIdentifiers(input.text)
  const unsupportedIdentifiers = new Set(responseIdentifiers.filter(identifier => (
    !supported.has(identifier) && !safeGapIdentifiers.has(identifier)
  )))

  const titles = messageTitleMap(input.sources, verifiedResults)
  for (const claim of novelExactMessageClaims) {
    if (!titles.has(claim.identifier) && !safeGapIdentifiers.has(claim.identifier)) {
      unsupportedIdentifiers.add(claim.identifier)
    }
  }

  const messageTextMismatches = responseMessageClaims.flatMap(claim => {
    const expected = titles.get(claim.identifier)
    if (!expected || sameExactMessage(claim.claimed, expected)) return []
    return [{ identifier: claim.identifier, claimed: claim.claimed, expected }]
  })
  const unsupportedIdentifierList = [...unsupportedIdentifiers]
  const userSuppliedTechnicalEvidence = userSuppliedRequirementsMayCountAsEvidence && (
    responseIdentifiers.some(identifier => suppliedIdentifiers.has(identifier))
      || responseMessageClaims.some(claim => suppliedExactClaim(claim, suppliedMessageClaims))
  )
  const evidenceGapOnlyResponse = !verifiedKnowledgeEvidence
    && !userSuppliedTechnicalEvidence
    && responseMessageClaims.length === 0
    && unsupportedIdentifierList.length === 0
    && isEvidenceGapResponse(input.text)

  return {
    // Authoritative knowledge and user-supplied requirements are both valid
    // evidence domains. New enterprise facts still fail closed unless verified.
    ok: (
      (verifiedKnowledgeEvidence || userSuppliedTechnicalEvidence)
        && unsupportedIdentifierList.length === 0
        && messageTextMismatches.length === 0
    ) || evidenceGapOnlyResponse,
    verifiedKnowledgeEvidence,
    unsupportedIdentifiers: unsupportedIdentifierList,
    messageTextMismatches,
  }
}

export const shouldFailClosedGroundedAnswer = (input: {
  plan: GroundingPlanLike
  coverage: GroundingCoverageResult
}) => Boolean(!input.coverage.ok)

export const groundingFailureText = () => (
  'Bu yanıtta doğrulanması gereken bir ayrıntı için yeterli güvenilir kanıt bulamadım. Doğrulanamayan kısmı kesin bilgi olarak vermiyorum.'
)
