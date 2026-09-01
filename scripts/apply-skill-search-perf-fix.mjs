import { readFileSync, writeFileSync } from 'node:fs'

const path = 'supabase/functions/_shared/skillTools.ts'
let source = readFileSync(path, 'utf8')

const replaceOrThrow = (from, to, label) => {
  if (!source.includes(from)) throw new Error(`Patch anchor not found: ${label}`)
  source = source.replace(from, to)
}

replaceOrThrow(
`const tokenSimilarity = (left: string, right: string) => {
  let best = 0
  for (const leftForm of tokenForms(left)) {
    for (const rightForm of tokenForms(right)) {
      if (!leftForm || !rightForm) continue
      if (leftForm === rightForm) return 1
      const shorter = Math.min(leftForm.length, rightForm.length)
      if (shorter >= 4 && (leftForm.startsWith(rightForm) || rightForm.startsWith(leftForm))) {
        best = Math.max(best, shorter / Math.max(leftForm.length, rightForm.length))
      }
      if (shorter >= 5) best = Math.max(best, diceSimilarity(leftForm, rightForm))
    }
  }
  return best
}
`,
`const TOKEN_SIMILARITY_CACHE = new Map<string, number>()

const tokenSimilarity = (left: string, right: string) => {
  const cacheKey = left <= right ? \`${'${left}'}\\u0000${'${right}'}\` : \`${'${right}'}\\u0000${'${left}'}\`
  const cached = TOKEN_SIMILARITY_CACHE.get(cacheKey)
  if (cached !== undefined) return cached

  let best = 0
  for (const leftForm of tokenForms(left)) {
    for (const rightForm of tokenForms(right)) {
      if (!leftForm || !rightForm) continue
      if (leftForm === rightForm) {
        best = 1
        break
      }
      const shorter = Math.min(leftForm.length, rightForm.length)
      if (shorter >= 4 && (leftForm.startsWith(rightForm) || rightForm.startsWith(leftForm))) {
        best = Math.max(best, shorter / Math.max(leftForm.length, rightForm.length))
      }
      if (shorter >= 5) best = Math.max(best, diceSimilarity(leftForm, rightForm))
    }
    if (best === 1) break
  }

  if (TOKEN_SIMILARITY_CACHE.size >= 4_096) TOKEN_SIMILARITY_CACHE.clear()
  TOKEN_SIMILARITY_CACHE.set(cacheKey, best)
  return best
}
`,
'token similarity memoization',
)

replaceOrThrow(
`  keyTokens: string[]
  titleTokens: string[]
  aliasTokens: string[]
  haystackTokens: string[]
`,
`  keyTokens: string[]
  titleTokens: string[]
  aliasTokens: string[]
  identityTokens: string[]
  identityTokenSet: Set<string>
  haystackTokens: string[]
  haystackTokenSet: Set<string>
`,
'index type',
)

replaceOrThrow(
`  const normalizedAliases = skill.aliases.map(normalize)
  const haystack = skillSearchText(skill)
  return {
    skill,
    normalizedKey,
    normalizedTitle,
    normalizedAliases,
    haystack,
    keyTokens: [...new Set(tokens(normalizedKey))],
    titleTokens: [...new Set(tokens(normalizedTitle))],
    aliasTokens: [...new Set(normalizedAliases.flatMap(tokens))],
    // Description/markdown is a recall field, not identity. A bounded prebuilt
    // token set prevents long skill documents from dominating both CPU and rank.
    haystackTokens: [...new Set(tokens(haystack))].slice(0, 96),
  }
`,
`  const normalizedAliases = skill.aliases.map(normalize)
  const haystack = skillSearchText(skill)
  const keyTokens = [...new Set(tokens(normalizedKey).flatMap(tokenForms))]
  const titleTokens = [...new Set(tokens(normalizedTitle).flatMap(tokenForms))]
  const aliasTokens = [...new Set(normalizedAliases.flatMap(tokens).flatMap(tokenForms))]
  const identityTokens = [...new Set([...keyTokens, ...titleTokens, ...aliasTokens])]
  // Description/markdown stays a broad exact-recall surface. Expensive fuzzy
  // comparison is intentionally limited to compact identity metadata.
  const haystackTokens = [...new Set(tokens(haystack).flatMap(tokenForms))].slice(0, 128)
  return {
    skill,
    normalizedKey,
    normalizedTitle,
    normalizedAliases,
    haystack,
    keyTokens,
    titleTokens,
    aliasTokens,
    identityTokens,
    identityTokenSet: new Set(identityTokens),
    haystackTokens,
    haystackTokenSet: new Set(haystackTokens),
  }
`,
'precomputed identity index',
)

replaceOrThrow(
`  let identityCoverage = 0
  for (const token of queryTokens) {
    const keySimilarity = bestTokenSimilarity(token, index.keyTokens)
    const titleSimilarity = bestTokenSimilarity(token, index.titleTokens)
    const aliasSimilarity = bestTokenSimilarity(token, index.aliasTokens)
    const identitySimilarity = Math.max(keySimilarity, titleSimilarity, aliasSimilarity)

    if (identitySimilarity >= 0.58) {
      identityCoverage += 1
      score += 4.5 * identitySimilarity * identitySimilarity
    } else {
      const haystackSimilarity = bestTokenSimilarity(token, index.haystackTokens)
      if (haystackSimilarity >= 0.72) score += 1.25 * haystackSimilarity * haystackSimilarity
    }
`,
`  let identityCoverage = 0
  for (const token of queryTokens) {
    const identitySimilarity = index.identityTokenSet.has(token)
      ? 1
      : bestTokenSimilarity(token, index.identityTokens)

    if (identitySimilarity >= 0.58) {
      identityCoverage += 1
      score += 4.5 * identitySimilarity * identitySimilarity
    } else if (index.haystackTokenSet.has(token)) {
      score += 1.25
    }
`,
'bounded fuzzy scoring',
)

replaceOrThrow(
`  const queryTokens = expandQueryTokens([...new Set(tokens(normalizedQuery))])
`,
`  const queryTokens = expandQueryTokens([...new Set(tokens(normalizedQuery).flatMap(tokenForms))])
`,
'query token forms',
)

writeFileSync(path, source)
console.log('Applied generic skill-search performance fix.')
