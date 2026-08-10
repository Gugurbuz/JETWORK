export interface DeterministicEnumerationFinalization {
  text: string
  totalCount: number
  collectedCount: number
  pageCount: number
  complete: boolean
  nextCursor: string | null
  filterKey: string
  toolName: string
}

type EnumerationRecord = {
  canonicalKey: string
  objectType: string
  name: string
  title: string
  summary: string
  sourceName: string
  inventoryRole?: 'documented' | 'referenced'
}

type EnumerationGroup = {
  filterKey: string
  toolName: string
  records: Map<string, EnumerationRecord>
  totalCount: number
  nextCursor: string | null
  pageCount: number
  lastSeenIndex: number
  documentedCount?: number
  referencedCount?: number
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

const callFilterKey = (toolName: string, args: Record<string, unknown>) => {
  if (toolName === 'list_class_inventory') {
    return ['class_inventory', normalizeTechnicalIdentifier(args.prefix)].join('|')
  }
  return [
    cleanString(args.objectType, 40).toLocaleLowerCase('en-US'),
    normalizeTechnicalIdentifier(args.prefix),
  ].join('|')
}

const recordFromUnknown = (value: unknown): EnumerationRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const canonicalKey = cleanString(row.canonicalKey, 320)
  if (!canonicalKey) return null
  const inventoryRole = row.inventoryRole === 'documented' || row.inventoryRole === 'referenced'
    ? row.inventoryRole
    : undefined
  return {
    canonicalKey,
    objectType: cleanString(row.objectType, 40),
    name: cleanString(row.name, 240),
    title: cleanString(row.title, 700),
    summary: cleanString(row.summary, 700),
    sourceName: cleanString(row.sourceName, 240),
    inventoryRole,
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
  if ((!detail || detail === name) && record.summary) detail = record.summary
  return detail && detail !== name ? `- **${name}:** ${detail}` : `- **${name}**`
}

const buildClassInventoryText = (group: EnumerationGroup) => {
  const records = [...group.records.values()].sort((left, right) => left.name.localeCompare(right.name))
  const documented = records.filter(record => record.inventoryRole === 'documented')
  const referenced = records.filter(record => record.inventoryRole !== 'documented')
  const documentedCount = group.documentedCount ?? documented.length
  const referencedCount = group.referencedCount ?? referenced.length
  const meta = {
    workSummary: [
      `${records.length} sınıf adı bulundu: ${documentedCount} tam belgelenmiş envanter kaydı, ${referencedCount} referans/bağımlılık kaydı.`,
    ],
    questions: [],
    actionSummary: `${records.length} class inventory kaydı deterministik olarak ayrıştırıldı.`,
  }
  return [
    `Kurumsal class envanteri kaynağında **${group.totalCount} sınıf adı** bulundu. Bunların **${documentedCount} tanesi tam belgelenmiş sınıf**, **${referencedCount} tanesi ise envanter dokümanında referans verilen/bağımlı sınıf**:`,
    '',
    `### Tam belgelenmiş sınıflar (${documentedCount})`,
    ...documented.map(displayRecordLine),
    '',
    `### Referans verilen sınıflar (${referencedCount})`,
    ...referenced.map(displayRecordLine),
    '',
    '<jetwork_meta>',
    JSON.stringify(meta),
    '</jetwork_meta>',
  ].join('\n')
}

const buildGenericText = (group: EnumerationGroup, complete: boolean) => {
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

const buildText = (group: EnumerationGroup, complete: boolean) => (
  group.toolName === 'list_class_inventory' && complete
    ? buildClassInventoryText(group)
    : buildGenericText(group, complete)
)

export const buildDeterministicEnumerationFinalization = (
  items: Array<Record<string, unknown>>,
  options: { allowPartial?: boolean } = {},
): DeterministicEnumerationFinalization | null => {
  const calls = new Map<string, { filterKey: string; toolName: string }>()
  const groups = new Map<string, EnumerationGroup>()

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const type = cleanString(item.type, 80)
    if (type === 'function_call') {
      const toolName = cleanString(item.name, 120)
      if (!['list_knowledge_catalog','list_class_inventory'].includes(toolName)) continue
      const args = parseJsonObject(item.arguments) || {}
      calls.set(cleanString(item.call_id, 240), { filterKey: callFilterKey(toolName, args), toolName })
      continue
    }
    if (type !== 'function_call_output') continue
    const call = calls.get(cleanString(item.call_id, 240))
    if (!call) continue
    const payload = parseJsonObject(item.output)
    if (!payload || cleanString(payload.tool, 120) !== call.toolName) continue
    const recordsPayload = payload.records && typeof payload.records === 'object' && !Array.isArray(payload.records)
      ? payload.records as Record<string, unknown>
      : null
    if (!recordsPayload) continue

    let group = groups.get(call.filterKey)
    if (!group) {
      group = {
        filterKey: call.filterKey,
        toolName: call.toolName,
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
    if (Number.isFinite(Number(recordsPayload.documentedCount))) group.documentedCount = Math.max(0, Number(recordsPayload.documentedCount))
    if (Number.isFinite(Number(recordsPayload.referencedCount))) group.referencedCount = Math.max(0, Number(recordsPayload.referencedCount))
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
    toolName: group.toolName,
  }
}
