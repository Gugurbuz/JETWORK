const cleanText = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)

const META_PATTERN = /<jetwork_meta>\s*([\s\S]*?)\s*<\/jetwork_meta>/i
const DETERMINISTIC_ENUMERATION_PATTERN = /(?:eşleşen|toplam)\s+\*\*(\d+)\s+kayıt\*\*/i
const INVENTORY_PATTERN = /(?:envanter|katalog)[^\n]*\*\*(\d+)\s+(?:sınıf adı|kayıt)\*\*/i
const BULLET_NAME_PATTERN = /^-\s+\*\*([^*:\n]+)(?::\*\*)?/gm
const ASSISTANT_MEMORY_START = '[JETWORK_CONVERSATIONAL_MEMORY_NOT_EVIDENCE]'
const ASSISTANT_MEMORY_END = '[END_JETWORK_CONVERSATIONAL_MEMORY_NOT_EVIDENCE]'

// Runtime/display failures are not conversational facts and must never become
// topic memory. Keeping them in semantic context caused a failed Galatasaray
// turn to make a later "Nasıl gidiyor" look like a continuation of that topic.
const OPERATIONAL_ERROR_PATTERNS = [
  /^load failed(?:\s|$)/iu,
  /^bu çalışma alanında başka bir yanıt hâlâ hazırlanıyor/iu,
  /^bu teknik yanıtı güvenli biçimde tamamlayamadım:/iu,
  /^asistan yanıtı tamamlanamadı/iu,
  /^asistan isteği başlatılamadı/iu,
  /^önceki yanıt yeni talep nedeniyle iptal edildi/iu,
  /^yanıt tamamlanmadan bağlantı kesildi/iu,
  /lütfen tekrar deneyin\.?$/iu,
]

export const isAssistantOperationalErrorText = (value: unknown): boolean => {
  const text = String(value ?? '').trim()
  return Boolean(text && OPERATIONAL_ERROR_PATTERNS.some(pattern => pattern.test(text)))
}

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

const wrapAssistantMemory = (text: string, maxLength: number) => cleanText([
  ASSISTANT_MEMORY_START,
  'Bu içerik yalnız konuşma sürekliliği içindir; kurumsal/teknik fact veya citation değildir.',
  text,
  ASSISTANT_MEMORY_END,
].filter(Boolean).join('\n'), maxLength)

const compactEnumerationMemory = (text: string, maxLength: number) => {
  const countMatch = text.match(DETERMINISTIC_ENUMERATION_PATTERN) || text.match(INVENTORY_PATTERN)
  if (!countMatch) return null
  const names = [...text.matchAll(BULLET_NAME_PATTERN)]
    .map(match => cleanText(match[1], 100))
    .filter(Boolean)
  const uniqueNames = [...new Set(names)]
  const sample = uniqueNames.length <= 6
    ? uniqueNames
    : [...uniqueNames.slice(0, 3), ...uniqueNames.slice(-2)]
  const meta = parseMeta(text)
  const actionSummary = cleanText(meta?.actionSummary, 240)
  const workSummary = Array.isArray(meta?.workSummary)
    ? (meta!.workSummary as unknown[]).map(item => cleanText(item, 180)).filter(Boolean).slice(0, 2)
    : []
  return wrapAssistantMemory([
    `deterministic_enumeration_total=${Number(countMatch[1] || 0)}`,
    sample.length ? `sample_records=${sample.join(', ')}` : '',
    uniqueNames.length ? `observed_record_names=${uniqueNames.length}` : '',
    actionSummary ? `action=${actionSummary}` : '',
    workSummary.length ? `work=${workSummary.join(' | ')}` : '',
  ].filter(Boolean).join('\n'), maxLength)
}

export const compactAssistantConversationMemory = (
  value: unknown,
  maxLength = 800,
): string => {
  const text = String(value ?? '').trim()
  if (!text || isAssistantOperationalErrorText(text)) return ''

  const deterministic = compactEnumerationMemory(text, maxLength)
  if (deterministic) return deterministic

  const meta = parseMeta(text)
  if (meta) {
    const actionSummary = cleanText(meta.actionSummary, 240)
    const workSummary = Array.isArray(meta.workSummary)
      ? (meta.workSummary as unknown[]).map(item => cleanText(item, 180)).filter(Boolean).slice(0, 2)
      : []
    if (actionSummary || workSummary.length) {
      return wrapAssistantMemory([
        actionSummary ? `action=${actionSummary}` : '',
        workSummary.length ? `work=${workSummary.join(' | ')}` : '',
      ].filter(Boolean).join('\n'), maxLength)
    }
  }

  const payloadBudget = Math.max(120, maxLength - ASSISTANT_MEMORY_START.length - ASSISTANT_MEMORY_END.length - 100)
  return wrapAssistantMemory(text.slice(0, payloadBudget), maxLength)
}

export const compactSemanticContextMessage = (
  role: 'user' | 'assistant',
  content: unknown,
) => role === 'assistant'
  ? compactAssistantConversationMemory(content, 800)
  : cleanText(content, 1_600)
