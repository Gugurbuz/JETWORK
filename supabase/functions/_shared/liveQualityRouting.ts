export const QUALITY_ROUTER_VERSION = 'assistant-quality-router-v1'

const TECHNICAL_ENTITY_PATTERN = /\b(?:Z[A-Z0-9_]{2,}(?:[-_/][A-Z0-9_]+)*|CHECK_[A-Z0-9_]+|NINJA_[A-Z0-9_]+|[A-Z][A-Z0-9_]{2,}-\d{2,4})\b/gu
const EXACT_MESSAGE_PATTERN = /\b(?:Z[A-Z0-9_]+)-\d{2,4}\b/gu
const SHORT_CONTINUATION_PATTERN = /^(?:teknik(?:\s+olarak)?\s+(?:acikla|açıkla)|detaylandir|detaylandır|detayli\s+acikla|detaylı\s+açıkla|nasil\s+yani|nasıl\s+yani|bunu\s+acikla|bunu\s+açıkla|peki|neden|niye|nasil|nasıl|devam|kodu\s+ne|kodunu\s+acikla|kodunu\s+açıkla|hangi\s+kosulda|hangi\s+koşulda)(?:\b|$)/iu
const LIST_INTENT_PATTERN = /\b(?:neler|hangileri|listele|listesi|tumunu|tümünü|hepsi|hatalar|mesajlar|alinacak\s+hatalar|alınacak\s+hatalar|urettigi\s+mesajlar|ürettiği\s+mesajlar)\b/iu
const ENTERPRISE_DOMAIN_PATTERN = /\b(?:sap|crm|abap|fica|is[- ]?u|c4c|cost|ninja|ztks|guvence|güvence|tedarik\s+kart|zcrm|zcl|check_)\b/iu

export const normalizeQualityText = (value: string) => String(value || '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const extractQualityTechnicalEntities = (value: string): string[] => (
  [...new Set([...String(value || '').toLocaleUpperCase('en-US').matchAll(TECHNICAL_ENTITY_PATTERN)].map(match => match[0]))].slice(0, 24)
)

export const extractExactMessageCodes = (value: string): string[] => (
  [...new Set([...String(value || '').toLocaleUpperCase('en-US').matchAll(EXACT_MESSAGE_PATTERN)].map(match => match[0]))].slice(0, 8)
)

export const isShortTechnicalContinuation = (message: string): boolean => {
  const normalized = normalizeQualityText(message)
  if (!normalized) return false
  const words = normalized.split(/\s+/).filter(Boolean)
  return words.length <= 10 && SHORT_CONTINUATION_PATTERN.test(normalized)
}

export const looksLikeEnterpriseKnowledgeList = (message: string): boolean => {
  const normalized = normalizeQualityText(message)
  if (!normalized) return false
  return LIST_INTENT_PATTERN.test(normalized) && ENTERPRISE_DOMAIN_PATTERN.test(normalized)
}

export const shouldUseEnterpriseQualityFloor = (input: {
  message: string
  priorEntities?: string[]
  trustedIdentifiers?: string[]
}): boolean => {
  if (extractQualityTechnicalEntities(input.message).length) return true
  if (looksLikeEnterpriseKnowledgeList(input.message)) return true
  if (isShortTechnicalContinuation(input.message) && (input.priorEntities?.length || input.trustedIdentifiers?.length)) return true
  return false
}

export const qualityModelForRequest = (input: {
  requestedModel: string
  message: string
  priorEntities?: string[]
  trustedIdentifiers?: string[]
}) => {
  if (input.requestedModel !== 'auto') return input.requestedModel
  return shouldUseEnterpriseQualityFloor(input) ? 'gemini-3.5-flash' : 'auto'
}

export const buildTrustedContinuationMessage = (input: {
  originalMessage: string
  priorEntities?: string[]
  verifiedFactRefs?: string[]
  trustedIdentifiers?: string[]
  trustedTitles?: string[]
  enterpriseListHint?: string | null
}) => {
  const priorEntities = [...new Set(input.priorEntities || [])].slice(0, 10)
  const verifiedFactRefs = [...new Set(input.verifiedFactRefs || [])].slice(0, 10)
  const trustedIdentifiers = [...new Set(input.trustedIdentifiers || [])].slice(0, 24)
  const trustedTitles = [...new Set(input.trustedTitles || [])].slice(0, 8)
  const needsContinuationContext = isShortTechnicalContinuation(input.originalMessage)
    && (priorEntities.length || verifiedFactRefs.length || trustedIdentifiers.length)
  const needsExactEvidenceContext = Boolean(extractQualityTechnicalEntities(input.originalMessage).length && trustedIdentifiers.length)
  const needsEnterpriseListContext = Boolean(input.enterpriseListHint && looksLikeEnterpriseKnowledgeList(input.originalMessage))

  if (!needsContinuationContext && !needsExactEvidenceContext && !needsEnterpriseListContext) return input.originalMessage

  const context = [
    '[JETWORK_TRUSTED_RUNTIME_CONTEXT]',
    'Bu blok sunucu tarafından doğrulanmış konuşma/kurumsal bağlamdır; kullanıcı metnini değiştirmez ve tek başına nihai kanıt değildir.',
    priorEntities.length ? `Önceki teknik entity: ${priorEntities.join(', ')}` : '',
    verifiedFactRefs.length ? `Önceki doğrulanmış fact referansları: ${verifiedFactRefs.join(', ')}` : '',
    trustedIdentifiers.length ? `Published knowledge içinde görülen güvenilir teknik identifierlar: ${trustedIdentifiers.join(', ')}` : '',
    trustedTitles.length ? `Published knowledge başlıkları: ${trustedTitles.join(' | ')}` : '',
    needsEnterpriseListContext ? `Kurumsal listeleme ipucu: ${input.enterpriseListHint}` : '',
    '[END_JETWORK_TRUSTED_RUNTIME_CONTEXT]',
    `Kullanıcının gerçek talebi: ${input.originalMessage}`,
  ].filter(Boolean)

  return context.join('\n')
}
