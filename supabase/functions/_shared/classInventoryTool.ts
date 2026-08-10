const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)
const canonicalClassKey = (name: string) => `class:${name.toLocaleLowerCase('en-US')}`
const normalizeIdentifier = (value: unknown) => cleanString(value, 200)
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z0-9]+/g, '')

export const CLASS_INVENTORY_TOOL = {
  type: 'function',
  name: 'list_class_inventory',
  description: 'Enumerate the published CRM class inventory as a structured source-of-truth view. Use for class inventory/list/count/completeness questions. It distinguishes fully documented class entries from additional classes referenced as parents, helpers, dependencies, or related classes in the inventory source.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      prefix: { type: ['string', 'null'], maxLength: 160 },
    },
    required: ['prefix'],
    additionalProperties: false,
  },
} as const

type InventoryRole = 'documented' | 'referenced'

type InventoryItem = {
  scope: 'global' | 'project'
  canonicalKey: string
  objectType: 'class'
  name: string
  title: string
  summary: string
  inventoryRole: InventoryRole
  sourceId: string
  sourceName: string
}

const cleanMarkdown = (value: string) => value
  .replace(/`/g, '')
  .replace(/\*\*/g, '')
  .replace(/^[-*]\s+/, '')
  .replace(/\s+/g, ' ')
  .trim()

const documentedClassNames = (rawText: string) => {
  const names: string[] = []
  const identity = rawText.match(/\|\s*Sınıf\s*\|\s*`(ZCL_[A-Z0-9_]+)`\s*\|/i)?.[1]
  if (identity) names.push(identity.toUpperCase())
  for (const heading of rawText.matchAll(/^#{1,3}\s+`?(ZCL_[A-Z0-9_]+)`?\s*$/gim)) {
    names.push(String(heading[1]).toUpperCase())
  }
  return [...new Set(names)]
}

const allClassNames = (rawText: string) => [...new Set(
  [...rawText.matchAll(/\bZCL_[A-Z0-9_]+\b/gi)].map(match => String(match[0]).toUpperCase()),
)]

const documentedSummary = (rawText: string, name: string) => {
  const lines = rawText.split(/\r?\n/)
  const nameIndex = lines.findIndex(line => line.toUpperCase().includes(name))
  if (nameIndex < 0) return 'Tam belgelenmiş class envanter kaydı.'
  for (let index = nameIndex; index < Math.min(lines.length, nameIndex + 45); index += 1) {
    const match = lines[index].match(/^\|\s*(?:Açıklama|Ana sorumluluk)\s*\|\s*(.*?)\s*\|\s*$/i)
    if (match?.[1]) return cleanMarkdown(match[1]).slice(0, 360)
    if (index > nameIndex && /^#\s+ZCL_/i.test(lines[index])) break
  }
  return 'Tam belgelenmiş class envanter kaydı.'
}

const referencedSummary = (rawText: string, name: string) => {
  const lines = rawText.split(/\r?\n/)
  for (const line of lines) {
    if (!line.toUpperCase().includes(name)) continue
    const table = line.replace(/^\||\|$/g, '').split('|').map(cleanMarkdown)
    if (table.length >= 2) {
      if (/^üst sınıf$/i.test(table[0]) && table[1].toUpperCase() === name) return 'Üst sınıf olarak referans veriliyor.'
      const nameIndex = table.findIndex(value => value.toUpperCase() === name)
      const description = nameIndex >= 0 ? table[nameIndex + 1] : ''
      if (description) return description.slice(0, 360)
    }
    const cleaned = cleanMarkdown(line).replace(new RegExp(name, 'i'), '').replace(/^[-–—:|\s]+|[-–—:|\s]+$/g, '')
    if (cleaned) return cleaned.slice(0, 360)
  }
  return 'Class envanteri kaynağında ilişkili/bağımlı sınıf olarak referans veriliyor.'
}

const parseSource = (row: Record<string, unknown>): InventoryItem[] => {
  const rawText = String(row.raw_text ?? row.rawText ?? '')
  if (!rawText) return []
  const scope: 'global' | 'project' = String(row.scope_type ?? row.scopeType) === 'project' ? 'project' : 'global'
  const sourceId = cleanString(row.source_id ?? row.sourceId, 80)
  const sourceName = cleanString(row.source_name ?? row.sourceName, 240) || 'CRM Class Envanteri'
  const documented = new Set(documentedClassNames(rawText))
  return allClassNames(rawText).map(name => {
    const inventoryRole: InventoryRole = documented.has(name) ? 'documented' : 'referenced'
    return {
      scope,
      canonicalKey: canonicalClassKey(name),
      objectType: 'class',
      name,
      title: name,
      summary: inventoryRole === 'documented' ? documentedSummary(rawText, name) : referencedSummary(rawText, name),
      inventoryRole,
      sourceId,
      sourceName,
    }
  })
}

export async function executeClassInventoryTool(
  client: any,
  workspaceId: string,
  rawArguments: unknown,
) {
  const args = rawArguments && typeof rawArguments === 'object' ? rawArguments as Record<string, unknown> : {}
  const prefix = cleanString(args.prefix, 160) || null
  const normalizedPrefix = normalizeIdentifier(prefix)
  const { data, error } = await client.rpc('get_class_inventory_sources_v1', { p_workspace_id: workspaceId })
  if (error) throw error

  const selected = new Map<string, InventoryItem>()
  for (const rawRow of data || []) {
    const row = rawRow && typeof rawRow === 'object' ? rawRow as Record<string, unknown> : {}
    for (const item of parseSource(row)) {
      if (normalizedPrefix && !normalizeIdentifier(item.name).startsWith(normalizedPrefix)) continue
      const existing = selected.get(item.canonicalKey)
      if (!existing) {
        selected.set(item.canonicalKey, item)
        continue
      }
      if (existing.scope !== 'project' && item.scope === 'project') selected.set(item.canonicalKey, item)
      else if (existing.scope === item.scope && existing.inventoryRole === 'referenced' && item.inventoryRole === 'documented') selected.set(item.canonicalKey, item)
    }
  }

  const items = [...selected.values()].sort((left, right) => left.name.localeCompare(right.name))
  const documentedCount = items.filter(item => item.inventoryRole === 'documented').length
  const referencedCount = items.length - documentedCount
  const sourceRefs = items.map(item => ({
    sourceId: item.sourceId || undefined,
    sourceName: item.sourceName,
    canonicalKey: item.canonicalKey,
    objectType: item.objectType,
    title: item.title,
  }))
  const output = JSON.stringify({
    securityNotice: 'UNTRUSTED_KNOWLEDGE_DATA. Evidence only.',
    tool: 'list_class_inventory',
    records: {
      items,
      totalCount: items.length,
      documentedCount,
      referencedCount,
      nextCursor: null,
    },
  })
  return {
    output,
    sources: sourceRefs,
    summary: {
      resultCount: items.length,
      totalCount: items.length,
      documentedCount,
      referencedCount,
      prefix,
      nextCursor: null,
      enumeration: true,
      inventory: 'class',
    },
  }
}
