export interface ResolvedConversationContextSeed {
  resolvedRequest?: string
  topic?: string
  activeEntities?: string[]
  userDecisions?: string[]
  rejectedScopes?: string[]
  rejectedHypotheses?: string[]
  openQuestions?: string[]
  retainedContext?: string[]
  verifiedFactRefs?: string[]
}

export interface ResolvedConversationContextOptions {
  maxHistoricalCharacters?: number
  recentConversationItems?: number
  relevantOlderUserItems?: number
}

const DEFAULT_HISTORY_CHARACTERS = 16_000
const DEFAULT_RECENT_ITEMS = 8
const DEFAULT_RELEVANT_OLDER_USER_ITEMS = 5

const cleanText = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

const normalize = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_./:-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const itemRole = (item: Record<string, unknown>) => String(item.role || '').toLocaleLowerCase('en-US')

const contentText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const record = part as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (typeof record.input_text === 'string') return record.input_text
    if (typeof record.output_text === 'string') return record.output_text
    return ''
  }).filter(Boolean).join('\n')
}

const withCompactedContent = (item: Record<string, unknown>, maxLength: number) => {
  if (!('content' in item)) return item
  const text = cleanText(contentText(item.content), maxLength)
  if (!text) return item
  return { ...item, content: text }
}

const isConversationItem = (item: Record<string, unknown>) => {
  const role = itemRole(item)
  return role === 'user' || role === 'assistant'
}

const isPersistentControlItem = (item: Record<string, unknown>) => {
  const role = itemRole(item)
  return role === 'system' || role === 'developer'
}

const isUserItem = (item: Record<string, unknown>) => itemRole(item) === 'user'

const tokenize = (value: string) => {
  const result = new Set<string>()
  for (const token of normalize(value).split(' ')) {
    if (token.length >= 3) result.add(token)
  }
  return result
}

const seedTerms = (seed: ResolvedConversationContextSeed) => {
  const text = [
    seed.resolvedRequest,
    seed.topic,
    ...(seed.activeEntities || []),
    ...(seed.userDecisions || []),
    ...(seed.rejectedScopes || []),
    ...(seed.openQuestions || []),
    ...(seed.retainedContext || []),
    ...(seed.verifiedFactRefs || []),
  ].filter(Boolean).join('\n')
  return tokenize(text)
}

const relevanceScore = (
  item: Record<string, unknown>,
  terms: Set<string>,
  activeEntities: string[],
) => {
  const text = contentText(item.content)
  if (!text) return 0
  const normalized = normalize(text)
  let score = 0

  for (const entity of activeEntities) {
    const normalizedEntity = normalize(entity)
    if (normalizedEntity && normalized.includes(normalizedEntity)) score += 40
  }

  if (terms.size) {
    const itemTerms = tokenize(text)
    for (const term of terms) if (itemTerms.has(term)) score += 3
  }

  // Older assistant prose is deliberately not promoted by lexical overlap.
  // It can be retained by recency, but durable context should primarily come
  // from user-authored instructions/decisions and structured resolved state.
  if (isUserItem(item) && score > 0) score += 4
  return score
}

const itemCharacterCost = (item: Record<string, unknown>) => {
  const content = contentText(item.content)
  if (content) return content.length
  try { return JSON.stringify(item).length }
  catch { return 0 }
}

export const buildResolvedConversationInstruction = (seed: ResolvedConversationContextSeed): string => {
  const lines = [
    '[JETWORK RESOLVED CONVERSATION STATE - NOT EVIDENCE]',
    'Bu blok yalnız konuşma/görev sürekliliği içindir; kurumsal gerçek veya citation değildir.',
    seed.resolvedRequest ? `Aktif çözülmüş talep: ${cleanText(seed.resolvedRequest, 1_500)}` : '',
    seed.topic ? `Aktif konu: ${cleanText(seed.topic, 400)}` : '',
    seed.activeEntities?.length ? `Aktif varlıklar: ${seed.activeEntities.map(value => cleanText(value, 180)).filter(Boolean).slice(0, 12).join(', ')}` : '',
    seed.userDecisions?.length ? `Kullanıcı kararları/kısıtları: ${seed.userDecisions.map(value => cleanText(value, 320)).filter(Boolean).slice(0, 8).join(' | ')}` : '',
    seed.rejectedScopes?.length ? `Artık kapsam dışı/reddedilmiş kapsamlar: ${seed.rejectedScopes.map(value => cleanText(value, 260)).filter(Boolean).slice(0, 8).join(' | ')}` : '',
    seed.rejectedHypotheses?.length ? `Reddedilmiş önceki hipotezler: ${seed.rejectedHypotheses.map(value => cleanText(value, 260)).filter(Boolean).slice(0, 6).join(' | ')}` : '',
    seed.openQuestions?.length ? `Açık konular: ${seed.openQuestions.map(value => cleanText(value, 260)).filter(Boolean).slice(0, 8).join(' | ')}` : '',
    seed.retainedContext?.length ? `Korunan yakın bağlam: ${seed.retainedContext.map(value => cleanText(value, 320)).filter(Boolean).slice(-6).join(' | ')}` : '',
    seed.verifiedFactRefs?.length ? `Önceki doğrulanmış kanıt referansları (iddia değil): ${seed.verifiedFactRefs.map(value => cleanText(value, 220)).filter(Boolean).slice(0, 12).join(', ')}` : '',
    'Yeni kullanıcı mesajı ve kullanıcı düzeltmeleri eski sohbetten üstündür. Reddedilmiş kapsam/hipotezleri kullanıcı yeniden istemedikçe geri getirme. Teknik/kurumsal iddialar için bu blok yerine gerçek knowledge/web kanıtı kullan.',
    '[END JETWORK RESOLVED CONVERSATION STATE]',
  ].filter(Boolean)
  return lines.join('\n')
}

export const compactResolvedConversationItems = (
  items: Array<Record<string, unknown>>,
  seed: ResolvedConversationContextSeed = {},
  options: ResolvedConversationContextOptions = {},
): Array<Record<string, unknown>> => {
  if (!items.length) return []

  const maxHistoricalCharacters = Math.max(4_000, options.maxHistoricalCharacters ?? DEFAULT_HISTORY_CHARACTERS)
  const recentConversationItems = Math.max(2, options.recentConversationItems ?? DEFAULT_RECENT_ITEMS)
  const relevantOlderUserItems = Math.max(0, options.relevantOlderUserItems ?? DEFAULT_RELEVANT_OLDER_USER_ITEMS)

  let currentUserIndex = -1
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (isUserItem(items[index])) {
      currentUserIndex = index
      break
    }
  }

  // A provider-recovery payload without a user item is unusual. Preserve it
  // rather than guessing where the current turn starts.
  if (currentUserIndex < 0) return [...items]

  const history = items.slice(0, currentUserIndex)
  const currentUser = items[currentUserIndex]
  // Everything after the current user belongs to the active provider/tool loop.
  // Keep function_call/function_call_output/reasoning protocol intact so context
  // compaction can never break tool-call pairing.
  const activeTurnTail = items.slice(currentUserIndex + 1)

  const conversationalIndices = history
    .map((item, index) => isConversationItem(item) ? index : -1)
    .filter(index => index >= 0)
  const recentIndices = new Set(conversationalIndices.slice(-recentConversationItems))
  const terms = seedTerms(seed)
  const entities = (seed.activeEntities || []).map(value => cleanText(value, 180)).filter(Boolean)

  const rankedOlderUsers = history
    .map((item, index) => ({ item, index, score: relevanceScore(item, terms, entities) }))
    .filter(candidate => isUserItem(candidate.item) && !recentIndices.has(candidate.index) && candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, relevantOlderUserItems)
  const relevantIndices = new Set(rankedOlderUsers.map(candidate => candidate.index))

  const candidates = history.map((item, index) => {
    const recent = recentIndices.has(index)
    const relevant = relevantIndices.has(index)
    const control = isPersistentControlItem(item)
    const selected = recent || relevant || control
    const score = control ? 20_000 : recent ? 10_000 + index : relevant
      ? relevanceScore(item, terms, entities)
      : 0
    const role = itemRole(item)
    const compacted = role === 'assistant'
      ? withCompactedContent(item, 900)
      : role === 'user'
        ? withCompactedContent(item, 2_400)
        : control
          ? withCompactedContent(item, 4_000)
          : item
    return { index, selected, score, compacted, cost: itemCharacterCost(compacted), protected: control || recent }
  }).filter(candidate => candidate.selected)

  let total = candidates.reduce((sum, candidate) => sum + candidate.cost, 0)
  if (total > maxHistoricalCharacters) {
    for (const candidate of [...candidates].sort((left, right) => left.score - right.score || left.index - right.index)) {
      if (total <= maxHistoricalCharacters) break
      if (candidate.protected) continue
      candidate.selected = false
      total -= candidate.cost
    }
  }

  // If even the recent protected window is larger than budget, trim oldest
  // recent items while always retaining at least the last user/assistant pair.
  if (total > maxHistoricalCharacters) {
    const protectedConversation = candidates
      .filter(candidate => candidate.selected && !isPersistentControlItem(history[candidate.index]))
      .sort((left, right) => left.index - right.index)
    const keepFloor = new Set(protectedConversation.slice(-2).map(candidate => candidate.index))
    for (const candidate of protectedConversation) {
      if (total <= maxHistoricalCharacters) break
      if (keepFloor.has(candidate.index)) continue
      candidate.selected = false
      total -= candidate.cost
    }
  }

  const selectedHistory = candidates
    .filter(candidate => candidate.selected)
    .sort((left, right) => left.index - right.index)
    .map(candidate => candidate.compacted)

  return [...selectedHistory, currentUser, ...activeTurnTail]
}
