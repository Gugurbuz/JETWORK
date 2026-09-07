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
  unsupportedClaims?: string[]
}

const clean = (value: unknown, max = 64_000) => String(value ?? '').trim().slice(0, max)
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

const verifiedIdentifierAliases = (identifier: string) => {
  const aliases = new Set([identifier])
  const messageCode = identifier.match(/^([A-Z][A-Z0-9_]{2,})-\d{2,4}$/)
  if (messageCode?.[1]) aliases.add(messageCode[1])
  return aliases
}

const verifiedAbapMessageIdentifiers = (value: unknown) => {
  const identifiers = new Set<string>()
  const text = clean(value)
  for (const match of text.matchAll(/\bMESSAGE\s+[A-Z]?(\d{2,4})\(([A-Z][A-Z0-9_]*)\)/gi)) {
    const messageClass = canonicalIdentifier(match[2] || '')
    const messageNumber = clean(match[1], 8)
    if (!messageClass || !messageNumber) continue
    const code = `${messageClass}-${messageNumber}`
    for (const alias of verifiedIdentifierAliases(code)) identifiers.add(alias)
  }
  return identifiers
}

// Response text remains deliberately strict: uppercase-looking standalone tokens
// only. Verified source code is a different trust domain and may legitimately
// contain lowercase ABAP identifiers, so it gets a narrower case-insensitive
// extractor that requires an underscore/path or an exact message-code suffix.
const TECHNICAL_IDENTIFIER_PATTERN = /(?<![\p{L}\p{N}_])(?:Z[A-Z0-9_]{2,}(?:-\d{2,4})?|CHECK_[A-Z0-9_]+)(?:(?:=>|\/)[A-Z][A-Z0-9_]*)?(?![\p{L}\p{N}_])/gu
const VERIFIED_SOURCE_TECHNICAL_IDENTIFIER_PATTERN = /(?<![\p{L}\p{N}_])(?:(?:Z[A-Z0-9]*_[A-Z0-9_]+)(?:(?:=>|\/)[A-Z][A-Z0-9_]*)?|Z[A-Z0-9_]{2,}-\d{2,4}|CHECK_[A-Z0-9_]+)(?![\p{L}\p{N}_])/giu
const CANONICAL_KEY_PATTERN = /\b(?:message|class|method|function|table|interface|document|business_rule):[a-z0-9_./-]+\b/gi
const MESSAGE_CODE_PATTERN = /\b[A-Z][A-Z0-9_]{2,}-\d{2,4}\b/g
const EVIDENCE_GAP_PATTERN = /(?:dogrulan(?:mis|abilir)\s+(?:bir\s+)?(?:kayit|kaynak|bilgi|kanit)\s+bulamad\w*|dogrulayamad\w*|teyit\s+edemed\w*|yeterli\s+(?:guvenilir\s+)?(?:kayit|kaynak|bilgi|kanit)\s+(?:yok|bulunmuyor|bulamad\w*)|kesin\s+(?:olarak\s+)?soyleyemem|mevcut\s+(?:kayit|kaynak|bilgi|kanit)(?:larda|ta|te)?\s+.*(?:yok|bulunmuyor|yer\s+almiyor)|could\s+not\s+verify|couldn'?t\s+verify|no\s+verified\s+(?:record|source|evidence|information)|insufficient\s+(?:reliable\s+)?(?:evidence|information))/i
const EVIDENCE_GAP_CONTRADICTION_PATTERN = /\b(?:ama|ancak|fakat|buna\s+ragmen|however|but|nevertheless)\b/i
const EXACT_MESSAGE_TEXT_REQUEST_PATTERN = /(?:mesaj\s*metn(?:i|ini|leri|lerini)?|mesaj(?:ın|in)\s+tam\s+metn(?:i|ini)|tam\s+mesaj\s*metn(?:i|ini)|exact\s+message\s+text|message\s+text)/i

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

const extractVerifiedSourceTechnicalIdentifiers = (value: unknown): string[] => {
  const values = new Set<string>()
  for (const match of clean(value).matchAll(VERIFIED_SOURCE_TECHNICAL_IDENTIFIER_PATTERN)) {
    const normalized = canonicalIdentifier(match[0])
    if (normalized) values.add(normalized)
  }
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

const exactMessageTextRequested = (text: string) => EXACT_MESSAGE_TEXT_REQUEST_PATTERN.test(normalizeText(text))

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
    (source.sourceType === 'knowledge' || !source.sourceType)
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
    const identifiers = new Set([
      ...extractTechnicalIdentifiers(clean(value)),
      ...extractVerifiedSourceTechnicalIdentifiers(value),
    ])
    for (const identifier of identifiers) {
      for (const alias of verifiedIdentifierAliases(identifier)) supported.add(alias)
    }
    for (const identifier of verifiedAbapMessageIdentifiers(value)) supported.add(identifier)
  }
  for (const source of sources) {
    if (source.sourceType === 'web') continue
    addText(source.canonicalKey)
  }
  for (const result of toolResults) {
    if (!resultHasVerifiedKnowledgeEvidence(result)) continue
    // Verified tool envelopes may carry mechanically derived identifier indexes
    // outside parsed record fields. Extract identifiers from the full verified
    // envelope as a defensive fallback; unverified search outputs never reach
    // this branch because resultHasVerifiedKnowledgeEvidence is required above.
    addText(result.output)
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
          addText((relation as Record<string, unknown>).evidence)
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

const exactMessageClaims = (
  text: string,
  options: { includeInlineClaims?: boolean } = {},
): Array<{ identifier: string; claimed: string }> => {
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
    if (options.includeInlineClaims !== true) continue
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

// For exact technical fact lookups, identifier-level grounding is necessary but
// not sufficient: finding `ZCRM2-545` somewhere does not support an invented
// trigger condition for that message. This narrow final-answer gate checks only
// causal/behavioral claim sentences and asks whether their substantive terms are
// directly represented in verified evidence text. It does not select a tool,
// formulate a query or prescribe a recovery action.
const EXACT_BEHAVIOR_CLAIM_PATTERN = /(?:\bkosul\w*\b|\bdurum\w*\b|\boldugunda\b|\bolursa\b|\bise\b|\bnedeniyle\b|\bdolayi\b|\btetik\w*\b|\balinir\b|\bolusur\b|\bverir\b|\bdondurur\b|\bkontrol\s+eder\b|\bengeller\b|\baktar\w*\b|\bwhen\b|\bif\b|\btrigger\w*\b|\boccur\w*\b|\bbecause\b|\breturn\w*\b|\bcheck\w*\b|\bprevent\w*\b)/i
const CLAIM_SUPPORT_STOPWORDS = new Set([
  'hangi','nedir','nasil','neden','icin','olan','olarak','veya','ama','ancak','fakat','ile','bir','bu','su','o','de','da','mi','mu','mı','mü',
  'mesaj','mesaji','hata','hatasi','kod','kodu','teknik','bilgi','kesin','sekilde','durum','durumda','kosul','kosulda','kosullarda','oldugunda','olursa',
  'ise','tetiklenir','tetikler','alinir','olusur','verir','dondurur','kontrol','eder','engeller','when','then','this','that','the','and','or','error','message',
  'code','occurs','triggered','triggers','returns','checks','prevents','because','with','from','into','does','what','which','how',
])

const supportTokens = (value: string) => {
  const withoutIdentifiers = normalizeText(value)
    .replace(/\b(?:z[a-z0-9_]{2,}(?:-\d{2,4})?|check_[a-z0-9_]+)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
  return [...new Set(withoutIdentifiers.split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4 && !CLAIM_SUPPORT_STOPWORDS.has(token)))]
}

const tokenRoot = (token: string) => token.slice(0, token.length >= 7 ? 5 : token.length >= 5 ? 4 : token.length)

const tokenIsSupported = (token: string, evidenceTokens: string[]) => {
  const root = tokenRoot(token)
  if (!root) return false
  return evidenceTokens.some(evidenceToken => {
    const evidenceRoot = tokenRoot(evidenceToken)
    return evidenceToken === token
      || evidenceToken.startsWith(root)
      || token.startsWith(evidenceRoot)
  })
}

const verifiedEvidenceText = (sources: GroundingSourceLike[], verifiedResults: GroundingToolResultLike[]) => [
  ...sources.filter(source => source.sourceType !== 'web').flatMap(source => [source.canonicalKey, source.title]),
  ...verifiedResults.flatMap(result => [
    result.output,
    ...result.sources.filter(source => source.sourceType !== 'web').flatMap(source => [source.canonicalKey, source.title]),
  ]),
].filter(Boolean).join('\n')

const unsupportedExactBehaviorClaims = (input: {
  responseText: string
  suppliedIdentifiers: Set<string>
  verifiedEvidence: string
  exactTechnicalFactLookup: boolean
}) => {
  if (!input.exactTechnicalFactLookup || !input.verifiedEvidence.trim()) return []
  const evidenceTokens = supportTokens(input.verifiedEvidence)
  if (!evidenceTokens.length) return []
  const segments = clean(input.responseText).split(/(?:\r?\n)+|(?<=[.!?])\s+/)
  return segments.flatMap(segment => {
    const normalized = normalizeText(segment)
    if (!normalized || isEvidenceGapResponse(segment) || !EXACT_BEHAVIOR_CLAIM_PATTERN.test(normalized)) return []
    const identifiers = extractTechnicalIdentifiers(segment)
    if (!identifiers.some(identifier => input.suppliedIdentifiers.has(identifier))) return []
    const tokens = supportTokens(segment)
    if (tokens.length < 2) return []
    const matched = tokens.filter(token => tokenIsSupported(token, evidenceTokens)).length
    const minimumMatches = Math.min(2, tokens.length)
    const ratio = matched / tokens.length
    return matched >= minimumMatches && ratio >= 0.4 ? [] : [clean(segment, 1_000)]
  })
}

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
  const verifyInlineMessageText = exactMessageTextRequested(suppliedText)
  // A message code plus an explanatory phrase is not automatically a claim that
  // the phrase is the exact T100/message text. Inline text becomes strict only
  // when the user explicitly asks for the message text. Explicit `Mesaj Metni:`
  // labels remain strict in every mode.
  const responseMessageClaims = exactMessageClaims(input.text, { includeInlineClaims: verifyInlineMessageText })
  const suppliedMessageClaims = exactMessageClaims(suppliedText, { includeInlineClaims: true })
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
    return { ok: true, verifiedKnowledgeEvidence: false, unsupportedIdentifiers: [], messageTextMismatches: [], unsupportedClaims: [] }
  }

  const verifiedResults = input.toolResults.filter(resultHasVerifiedKnowledgeEvidence)
  const verifiedKnowledgeEvidence = verifiedResults.length > 0 || input.sources.some(source => (
    (source.sourceType === 'knowledge' || !source.sourceType)
    && Boolean(clean(source.canonicalKey, 320) || clean(source.sourceId, 120))
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
  const unsupportedClaims = unsupportedExactBehaviorClaims({
    responseText: input.text,
    suppliedIdentifiers,
    verifiedEvidence: verifiedEvidenceText(input.sources, verifiedResults),
    exactTechnicalFactLookup,
  })
  const userSuppliedTechnicalEvidence = userSuppliedRequirementsMayCountAsEvidence && (
    responseIdentifiers.some(identifier => suppliedIdentifiers.has(identifier))
      || responseMessageClaims.some(claim => suppliedExactClaim(claim, suppliedMessageClaims))
  )
  const evidenceGapOnlyResponse = !verifiedKnowledgeEvidence
    && !userSuppliedTechnicalEvidence
    && responseMessageClaims.length === 0
    && unsupportedIdentifierList.length === 0
    && unsupportedClaims.length === 0
    && isEvidenceGapResponse(input.text)

  return {
    // Authoritative knowledge and user-supplied requirements are both valid
    // evidence domains. New enterprise facts still fail closed unless verified.
    // Exact behavior/condition claims also need direct lexical support from
    // verified evidence rather than merely sharing an identifier with it.
    ok: (
      (verifiedKnowledgeEvidence || userSuppliedTechnicalEvidence)
        && unsupportedIdentifierList.length === 0
        && messageTextMismatches.length === 0
        && unsupportedClaims.length === 0
    ) || evidenceGapOnlyResponse,
    verifiedKnowledgeEvidence,
    unsupportedIdentifiers: unsupportedIdentifierList,
    messageTextMismatches,
    unsupportedClaims,
  }
}

export const shouldFailClosedGroundedAnswer = (input: {
  plan: GroundingPlanLike
  coverage: GroundingCoverageResult
}) => Boolean(!input.coverage.ok)

export const groundingFailureText = () => (
  'Bu teknik yanıtı güvenli biçimde tamamlayamadım: doğrulanması gereken ayrıntılar için yeterli güvenilir kanıt bulunamadı. Doğrulanamayan kısmı kesin bilgi olarak vermiyorum.'
)