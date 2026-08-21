const TECHNICAL_IDENTIFIER = /\b(?:[A-Z][A-Z0-9]*_[A-Z0-9_/-]{2,}|Z[A-Z0-9_/-]{2,}|[A-Z][A-Z0-9_]{3,}-\d{2,4})\b/giu

export type TechnicalRelationTargetType = 'message' | 'table' | 'function' | 'class' | 'method'

export interface TechnicalReferenceRelationLookup {
  technicalReference: string
  targetObjectTypes: TechnicalRelationTargetType[] | null
  relationKind: 'messages' | 'tables' | 'functions' | 'classes' | 'methods' | 'usage'
}

const MESSAGE_RELATION_INTENT = /(?:\bhangi\s+(?:hata\s+)?mesaj(?:ı|i|ları|lari)?\b|\b(?:hata\s+)?mesaj(?:ı|i|ları|lari)?\s+(?:neler|nelerdir|hangileri|üret(?:iyor|ir)?|uretiyor|ver(?:iyor|ir)?|döndür(?:üyor|ur)?|donduruyor)\b|\b(?:üret(?:tiği|tigi)|verdiği|verdigi|döndürdüğü|dondurdugu)\s+(?:hata\s+)?mesaj(?:ı|i|ları|lari)?\b)/iu
const TABLE_RELATION_INTENT = /(?:hangi\s+tablo(?:yu|ları|lari)?|tablo(?:ları|lari)?\s+(?:neler|hangileri|okuyor|yazıyor|kullanıyor)|hangi\s+tablolara)/iu
const FUNCTION_RELATION_INTENT = /(?:hangi\s+(?:fm|function|fonksiyon)(?:leri|ları|lari)?|(?:fm|function|fonksiyon)(?:leri|ları|lari)?\s+(?:neler|hangileri|çağırıyor|cagiriyor|kullanıyor))/iu
const CLASS_RELATION_INTENT = /(?:hangi\s+(?:class|sınıf|sinif)(?:ları|lari)?|(?:class|sınıf|sinif)(?:ları|lari)?\s+(?:neler|hangileri|kullanıyor|bağlı|bagli))/iu
const METHOD_RELATION_INTENT = /(?:hangi\s+(?:method|metot)(?:ları|lari)?|(?:method|metot)(?:ları|lari)?\s+(?:neler|hangileri|çağırıyor|cagiriyor|kullanıyor))/iu
const USAGE_RELATION_INTENT = /(?:nerede\s+kullan(?:ılıyor|iliyor)|kim\s+kullan(?:ıyor|iyor)|hangi\s+yerlerde\s+kullan(?:ılıyor|iliyor)|bağlantıları\s+neler|baglantilari\s+neler)/iu

const normalizeTechnicalReference = (value: string): string => String(value || '').trim().toLocaleUpperCase('en-US')

export const extractTechnicalReference = (message: string): string => {
  const matches = [...String(message || '').toLocaleUpperCase('en-US').matchAll(TECHNICAL_IDENTIFIER)]
  return normalizeTechnicalReference(matches[0]?.[0] || '')
}

export const detectTechnicalReferenceRelationLookup = (
  message: string,
): TechnicalReferenceRelationLookup | null => {
  const text = String(message || '').trim()
  const technicalReference = extractTechnicalReference(text)
  if (!technicalReference) return null

  if (MESSAGE_RELATION_INTENT.test(text)) return { technicalReference, targetObjectTypes: ['message'], relationKind: 'messages' }
  if (TABLE_RELATION_INTENT.test(text)) return { technicalReference, targetObjectTypes: ['table'], relationKind: 'tables' }
  if (FUNCTION_RELATION_INTENT.test(text)) return { technicalReference, targetObjectTypes: ['function'], relationKind: 'functions' }
  if (CLASS_RELATION_INTENT.test(text)) return { technicalReference, targetObjectTypes: ['class'], relationKind: 'classes' }
  if (METHOD_RELATION_INTENT.test(text)) return { technicalReference, targetObjectTypes: ['method'], relationKind: 'methods' }
  if (USAGE_RELATION_INTENT.test(text)) return { technicalReference, targetObjectTypes: null, relationKind: 'usage' }
  return null
}

export const contentReferencesTechnicalReference = (
  content: string,
  technicalReference: string,
): boolean => {
  const ref = normalizeTechnicalReference(technicalReference)
  if (!ref) return false
  const haystack = String(content || '').toLocaleUpperCase('en-US')
  const index = haystack.indexOf(ref)
  if (index < 0) return false
  const left = index > 0 ? haystack[index - 1] : ''
  const right = index + ref.length < haystack.length ? haystack[index + ref.length] : ''
  const identifierChar = /[A-Z0-9_/-]/u
  return !identifierChar.test(left) && !identifierChar.test(right)
}
