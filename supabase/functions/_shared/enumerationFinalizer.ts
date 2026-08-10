export interface DeterministicEnumerationFinalization {
  text: string
  totalCount: number
  collectedCount: number
  pageCount: number
  complete: boolean
  nextCursor: string | null
  filterKey: string
}

type EnumerationRecord = {
  canonicalKey: string
  objectType: string
  name: string
  title: string
  summary: string
  sourceName: string
}

type EnumerationGroup = {
  filterKey: string
  records: Map<string, EnumerationRecord>
  totalCount: number
  nextCursor: string | null
  pageCount: number
  lastSeenIndex: number
}

const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const normalizeTechnicalIdentifier = (value: unknown) => cleanString(value, 240)
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z0-9]+/g, '')

const callFilterKey = (args: Record<string, unknown>) => [
  cleanString(args.objectType, 40).toLocaleLowerCase('en-US'),
  normalizeTechnicalIdentifier(args.prefix),
].join('|')

const recordFromUnknown = (value: unknown): EnumerationRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const canonicalKey = cleanString(row.canonicalKey, 320)
  if (!canonicalKey) return null
  return {
    canonicalKey,
    objectType: cleanString(row.objectType, 40),
    name: cleanString(row.name, 240),
    title: cleanString(row.title, 700),
    summary: cleanString(row.summary, 700),
    sourceName: cleanString(row.sourceName, 240),
  }
}

const displayRecordLine = (record: EnumerationRecord) => {
  const fallbackName = record.canonicalKey.includes(':')
    ? record.canonicalKey.slice(record.canonicalKey.indexOf(':') + 1)
    : record.canonicalKey
  const name = record.name || fallbackName
  let detail = record.title || record.summary
  if (detail && name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    detail = detail.replace(new RegExp(`^${escapedName}\\s*(?:—|–|-|:)?\\s*`, 'i'), '').trim()
  }
  if (!detail && record.summary) detail = record.summary
  return detail ? `- **${name}:** ${detail}` : `- **${name}**`
}

const buildText = (group: EnumerationGroup, complete: boolean) => {
  const records = [...group.records.values()].sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey))
  const collectedCount = records.length
  const intro = complete
    ? `Kurumsal bilgi kataloğunda eşleşen **${group.totalCount} kayıt** bulundu. Tam liste:`
    : `Kurumsal bilgi kataloğunda toplam **${group.totalCount} kayıt** var. Güvenli araştırma bütçesi içinde **${collectedCount} kayıt** getirilebildi; aşağıdaki liste kısmi:`
  const actionSummary = complete
    ? `${group.totalCount} katalog kaydı deterministik olarak listelendi.`
    : `${collectedCount}/${group.totalCount} katalog kaydı deterministik olarak listelendi; sonuç kısmi.`
  const meta = {
    workSummary: [
      complete
        ? `${group.pageCount} sayfada ${collectedCount} kayıt toplandı ve pagination tamamlandı.`
        : `${group.pageCount} sayfada ${collectedCount}/${group.totalCount} kayıt toplandı; pagination tamamlanamadı.`,
    ],
    questions: [],
    actionSummary,
  }
  return [
    intro,
    '',
    ...records.map(displayRecordLine),
    '',
    '<jetwork_meta>',
    JSON.stringify(meta),
    '</jetwork_meta>',
  ].join('\n')
}

export const buildDeterministicEnumerationFinalization = (
  items: Array<Record<string, unknown>>,
  options: { allowPartial?: boolean } = {},
): DeterministicEnumerationFinalization | null => {
  const calls = new Map<string, { filterKey: string }>()
  const groups = new Map<string, EnumerationGroup>()

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const type = cleanString(item.type, 80)
    if (type === 'function_call' && cleanString(item.name, 120) === 'list_knowledge_catalog') {
      const args = parseJsonObject(item.arguments) || {}
      calls.set(cleanString(item.call_id, 240), { filterKey: callFilterKey(args) })
      continue
    }
    if (type !== 'function_call_output') continue
    const call = calls.get(cleanString(item.call_id, 240))
    if (!call) continue
    const payload = parseJsonObject(item.output)
    if (!payload || cleanString(payload.tool, 120) !== 'list_knowledge_catalog') continue
    const recordsPayload = payload.records && typeof payload.records === 'object' && !Array.isArray(payload.records)
      ? payload.records as Record<string, unknown>
      : null
    if (!recordsPayload) continue

    let group = groups.get(call.filterKey)
    if (!group) {
      group = {
        filterKey: call.filterKey,
        records: new Map<string, EnumerationRecord>(),
        totalCount: 0,
        nextCursor: null,
        pageCount: 0,
        lastSeenIndex: index,
      }
      groups.set(call.filterKey, group)
    }

    const pageItems = Array.isArray(recordsPayload.items) ? recordsPayload.items : []
    for (const candidate of pageItems) {
      const record = recordFromUnknown(candidate)
      if (record) group.records.set(record.canonicalKey, record)
    }
    group.totalCount = Math.max(group.totalCount, Math.max(0, Number(recordsPayload.totalCount || 0)))
    group.nextCursor = cleanString(recordsPayload.nextCursor, 320) || null
    group.pageCount += 1
    group.lastSeenIndex = index
  }

  const candidates = [...groups.values()]
    .filter(group => group.records.size > 0 && group.totalCount > 0)
    .sort((left, right) => right.lastSeenIndex - left.lastSeenIndex)
  const group = candidates[0]
  if (!group) return null

  const collectedCount = group.records.size
  const complete = group.nextCursor === null && collectedCount >= group.totalCount
  const allowPartial = options.allowPartial === true && group.pageCount >= 2
  if (!complete && !allowPartial) return null

  return {
    text: buildText(group, complete),
    totalCount: group.totalCount,
    collectedCount,
    pageCount: group.pageCount,
    complete,
    nextCursor: group.nextCursor,
    filterKey: group.filterKey,
  }
}
