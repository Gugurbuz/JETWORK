const TECHNICAL_REFERENCE = /\b(CHECK_[A-Z0-9_]+)\b/iu
const MESSAGE_RELATION_INTENT = /(?:\bhangi\s+(?:hata\s+)?mesaj(?:ı|i|ları|lari)?\b|\b(?:hata\s+)?mesaj(?:ı|i|ları|lari)?\s+(?:neler|nelerdir|hangileri|üret(?:iyor|ir)?|uretiyor|ver(?:iyor|ir)?|döndür(?:üyor|ur)?|donduruyor)\b|\b(?:üret(?:tiği|tigi)|verdiği|verdigi|döndürdüğü|dondurdugu)\s+(?:hata\s+)?mesaj(?:ı|i|ları|lari)?\b)/iu

export const detectTechnicalReferenceMessageLookup = (message: string): string => {
  const text = String(message || '').trim()
  if (!MESSAGE_RELATION_INTENT.test(text)) return ''
  return text.match(TECHNICAL_REFERENCE)?.[1]?.toLocaleUpperCase('en-US') || ''
}

export const contentReferencesTechnicalReference = (
  content: string,
  technicalReference: string,
): boolean => {
  const ref = String(technicalReference || '').trim().toLocaleUpperCase('en-US')
  if (!/^CHECK_[A-Z0-9_]+$/u.test(ref)) return false
  const haystack = String(content || '').toLocaleUpperCase('en-US')
  const index = haystack.indexOf(ref)
  if (index < 0) return false
  const left = index > 0 ? haystack[index - 1] : ''
  const right = index + ref.length < haystack.length ? haystack[index + ref.length] : ''
  const identifierChar = /[A-Z0-9_]/u
  return !identifierChar.test(left) && !identifierChar.test(right)
}
