const cleanText = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

const META_PATTERN = /<jetwork_meta>\s*([\s\S]*?)\s*<\/jetwork_meta>/i
const DETERMINISTIC_ENUMERATION_PATTERN = /(?:eşleşen|toplam)\s+\*\*(\d+)\s+kayıt\*\*/i
const INVENTORY_PATTERN = /(?:envanter|katalog)[^\n]*\*\*(\d+)\s+(?:sınıf adı|kayıt)\*\*/i
const BULLET_NAME_PATTERN = /^-\s+\*\*([^*:\n]+)(?::\*\*)?/gm

const parseMeta = (text: string): Record<string, unknown> | null => {
  const match = text.match(META_PATTERN)
  if (!match?.[1]) return null
  try {
    const parsed = JSON.parse(match[1])
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const compactEnumerationMemory = (text: string, maxLength: number) => {
  const countMatch = text.match(DETERMINISTIC_ENUMERATION_PATTERN) || text.match(INVENTORY_PATTERN)
  if (!countMatch) return null
  const names = [...text.matchAll(BULLET_NAME_PATTERN)]
    .map(match => cleanText(match[1], 120))
    .filter(Boolean)
  const uniqueNames = [...new Set(names)]
  const sample = uniqueNames.length <= 8
    ? uniqueNames
    : [...uniqueNames.slice(0, 4), ...uniqueNames.slice(-3)]
  const meta = parseMeta(text)
  const actionSummary = cleanText(meta?.actionSummary, 360)
  const workSummary = Array.isArray(meta?.workSummary)
    ? (meta!.workSummary as unknown[]).map(item => cleanText(item, 260)).filter(Boolean).slice(0, 2)
    : []
  return cleanText([
    '[JETWORK_COMPACT_MEMORY]',
    `deterministic_enumeration_total=${Number(countMatch[1] || 0)}`,
    sample.length ? `sample_records=${sample.join(', ')}` : '',
    uniqueNames.length ? `observed_record_names=${uniqueNames.length}` : '',
    actionSummary ? `action=${actionSummary}` : '',
    workSummary.length ? `work=${workSummary.join(' | ')}` : '',
    '[END_JETWORK_COMPACT_MEMORY]',
  ].filter(Boolean).join('\n'), maxLength)
}

export const compactAssistantConversationMemory = (
  value: unknown,
  maxLength = 1_200,
): string => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (text.length <= maxLength) return text

  const deterministic = compactEnumerationMemory(text, maxLength)
  if (deterministic) return deterministic

  const meta = parseMeta(text)
  if (meta) {
    const actionSummary = cleanText(meta.actionSummary, 360)
    const workSummary = Array.isArray(meta.workSummary)
      ? (meta.workSummary as unknown[]).map(item => cleanText(item, 260)).filter(Boolean).slice(0, 3)
      : []
    if (actionSummary || workSummary.length) {
      return cleanText([
        '[JETWORK_COMPACT_MEMORY]',
        actionSummary ? `action=${actionSummary}` : '',
        workSummary.length ? `work=${workSummary.join(' | ')}` : '',
        '[END_JETWORK_COMPACT_MEMORY]',
      ].filter(Boolean).join('\n'), maxLength)
    }
  }

  return text.slice(0, maxLength)
}

export const compactSemanticContextMessage = (
  role: 'user' | 'assistant',
  content: unknown,
) => role === 'assistant'
  ? compactAssistantConversationMemory(content, 1_200)
  : cleanText(content, 2_500)
