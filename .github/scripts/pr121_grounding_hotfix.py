from pathlib import Path

path = Path('supabase/functions/_shared/groundingGuard.ts')
text = path.read_text()

def replace_once(old: str, new: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'groundingGuard exact patch expected 1 occurrence, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)

replace_once(
"""const suppliedRequestText = (plan: GroundingPlanLike) => [
  clean(plan.goal, 32_000),
  clean(plan.conversationState?.resolvedRequest, 32_000),
].filter(Boolean).join('\\n')
""",
"""const suppliedRequestText = (plan: GroundingPlanLike) => [
  clean(plan.goal, 32_000),
  clean(plan.conversationState?.resolvedRequest, 32_000),
].filter(Boolean).join('\\n')

// A user may mention an enterprise identifier while supplying a requirement; that
// alone is not authoritative evidence. Exact fact lookups (messages, errors,
// behavior, conditions, call locations) must still be verified at the response
// boundary even if semantic planning left enterpriseGroundingRequired=false.
const EXACT_TECHNICAL_FACT_REQUEST_PATTERN = /(?:hangi\\s+(?:mesaj(?:lar)?|hata(?:lar)?|tablo(?:lar)?|alan(?:lar)?|metot(?:lar)?|method(?:s)?|class(?:es)?|function(?:s)?)|hangi\\s+kosul(?:da|larda)?|ne\\s+(?:yapar|yapiyor|uretir|dondurur|kontrol\\s+eder)|nerede\\s+(?:kullanilir|cagrilir)|what\\s+(?:messages?|errors?|tables?|fields?|methods?|functions?)|which\\s+(?:messages?|errors?|tables?|fields?|methods?|functions?)|what\\s+does|how\\s+does)/i

const exactTechnicalFactLookupRequested = (text: string, identifiers: Set<string>) => (
  identifiers.size > 0 && EXACT_TECHNICAL_FACT_REQUEST_PATTERN.test(normalizeText(text))
)
"""
)

replace_once(
"""  const novelResponseIdentifiers = responseIdentifiers.filter(identifier => !suppliedIdentifiers.has(identifier))
  const novelExactMessageClaims = responseMessageClaims.filter(claim => !suppliedExactClaim(claim, suppliedMessageClaims))

  // An explicit enterprise-grounding decision remains authoritative. When the
  // plan does not require grounding, only *new* technical facts introduced by
  // the model activate the strict guard; facts supplied by the user may be
  // analysed without forcing an unrelated knowledge lookup.
  const strictEnterpriseClaim = enterpriseGroundingRequiredForPlan(input.plan)
    || novelResponseIdentifiers.length > 0
    || novelExactMessageClaims.length > 0
""",
"""  const novelResponseIdentifiers = responseIdentifiers.filter(identifier => !suppliedIdentifiers.has(identifier))
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
"""
)

replace_once(
"""  const supported = verifiedIdentifierSet(input.sources, verifiedResults)
  for (const identifier of suppliedIdentifiers) supported.add(identifier)
""",
"""  const supported = verifiedIdentifierSet(input.sources, verifiedResults)
  if (userSuppliedRequirementsMayCountAsEvidence) {
    for (const identifier of suppliedIdentifiers) supported.add(identifier)
  }
"""
)

replace_once(
"""  const userSuppliedTechnicalEvidence = responseIdentifiers.some(identifier => suppliedIdentifiers.has(identifier))
    || responseMessageClaims.some(claim => suppliedExactClaim(claim, suppliedMessageClaims))
""",
"""  const userSuppliedTechnicalEvidence = userSuppliedRequirementsMayCountAsEvidence && (
    responseIdentifiers.some(identifier => suppliedIdentifiers.has(identifier))
      || responseMessageClaims.some(claim => suppliedExactClaim(claim, suppliedMessageClaims))
  )
"""
)

path.write_text(text)
