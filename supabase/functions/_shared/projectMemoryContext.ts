export interface ProjectMemoryContextRow {
  memory_key?: unknown
  value?: unknown
  category?: unknown
  source_type?: unknown
  confirmation_state?: unknown
  memory_version?: unknown
  valid_from?: unknown
  updated_at?: unknown
}

export interface ProjectMemoryContextItem {
  key: string
  value: string
  category: string
  version: number
  validFrom?: string
}

const cleanText = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

const normalize = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_./:-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const tokenize = (value: string) => new Set(
  normalize(value).split(' ').filter(token => token.length >= 3),
)

const memoryState = (row: ProjectMemoryContextRow) => cleanText(row.confirmation_state, 40).toLocaleLowerCase('en-US')
const memorySourceType = (row: ProjectMemoryContextRow) => cleanText(row.source_type, 40).toLocaleLowerCase('en-US')

const isTrustedMemoryRow = (row: ProjectMemoryContextRow) => {
  const state = memoryState(row)
  const sourceType = memorySourceType(row)
  return state === 'confirmed' || (sourceType === 'user_message' && state !== 'rejected')
}

// A rejection is a tombstone only when it comes from an authoritative source.
// This prevents a newer AI-proposed/rejected row from erasing a confirmed user
// decision while still allowing the user's explicit correction to invalidate it.
const isAuthoritativeRejectedRow = (row: ProjectMemoryContextRow) => (
  memoryState(row) === 'rejected' && memorySourceType(row) === 'user_message'
)

const memoryTimestamp = (row: ProjectMemoryContextRow) => {
  const parsed = Date.parse(cleanText(row.valid_from || row.updated_at, 80))
  return Number.isFinite(parsed) ? parsed : 0
}

const relevanceScore = (item: ProjectMemoryContextItem, query: string, queryTerms: Set<string>) => {
  const normalizedQuery = normalize(query)
  const normalizedKey = normalize(item.key)
  const normalizedValue = normalize(item.value)
  let score = 0

  if (normalizedKey && normalizedQuery.includes(normalizedKey)) score += 80
  if (normalizedValue.length >= 6 && normalizedQuery.includes(normalizedValue)) score += 60

  const itemTerms = tokenize(`${item.key} ${item.value}`)
  for (const term of queryTerms) if (itemTerms.has(term)) score += 5

  // Category weights only break ties among already relevant memories. They do
  // not make an unrelated project decision leak into a new topic.
  if (score > 0 && ['decision','constraint','requirement','preference','business_rule'].includes(item.category)) score += 3
  return score
}

export const selectProjectMemoryContext = (
  rows: ProjectMemoryContextRow[],
  query: string,
  limit = 12,
): ProjectMemoryContextItem[] => {
  const safeQuery = cleanText(query, 4_000)
  if (!safeQuery || !rows.length) return []

  // Resolve version/timestamp first, including explicit user rejections. Only
  // after the newest authoritative row is selected do we decide whether it is
  // usable context or a tombstone. This keeps stale confirmed versions dead.
  const authoritativeByKey = new Map<string, { row: ProjectMemoryContextRow; version: number; timestamp: number }>()
  for (const row of rows) {
    if (!isTrustedMemoryRow(row) && !isAuthoritativeRejectedRow(row)) continue
    const key = cleanText(row.memory_key, 240)
    const value = cleanText(row.value, 1_200)
    if (!key || !value) continue
    const version = Math.max(1, Number(row.memory_version || 1) || 1)
    const timestamp = memoryTimestamp(row)
    const existing = authoritativeByKey.get(key)
    if (!existing || version > existing.version || (version === existing.version && timestamp > existing.timestamp)) {
      authoritativeByKey.set(key, { row, version, timestamp })
    }
  }

  const queryTerms = tokenize(safeQuery)
  return [...authoritativeByKey.entries()]
    .filter(([, selected]) => !isAuthoritativeRejectedRow(selected.row))
    .map(([key, selected]) => {
      const item: ProjectMemoryContextItem = {
        key,
        value: cleanText(selected.row.value, 1_200),
        category: cleanText(selected.row.category || 'fact', 40).toLocaleLowerCase('en-US'),
        version: selected.version,
        validFrom: cleanText(selected.row.valid_from || selected.row.updated_at, 80) || undefined,
      }
      return { item, score: relevanceScore(item, safeQuery, queryTerms), timestamp: selected.timestamp }
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.timestamp - left.timestamp)
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(candidate => candidate.item)
}
