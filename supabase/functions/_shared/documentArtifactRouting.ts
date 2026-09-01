import { ENERJISA_ANALYSIS_DOCX_DIRECTIVE } from './enerjisaDocumentContract.ts'

export { ENERJISA_ANALYSIS_DOCX_DIRECTIVE } from './enerjisaDocumentContract.ts'

export interface DocumentArtifactRouteDecision {
  artifactRoute: boolean
  enerjisaAnalysisDocx: boolean
  reason: 'explicit_docx' | 'enerjisa_analysis_document' | 'none'
}

export const DOCUMENT_FILE_EXECUTOR_TOOL = 'create_document_file'

const normalizeIntent = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const CREATE_ACTION = /\b(?:olustur|hazirla|uret|yaz|cikar|donustur|export)\w*\b/u
const REVISE_ACTION = /\b(?:guncelle|revize|yenile|duzelt|degistir|ekle|isle)\w*\b/u
const FILE_TARGET = /\b(?:dosya|dokuman|belge|rapor|analiz|format)\w*\b/u
const ANALYSIS_DOCUMENT_TARGET = /\b(?:is analizi|ihtiyac analizi|analiz dokumani|analiz raporu|kavramsal tasarim)\b/u
const ANALYSIS_WORD = /\banaliz\w*\b/u
const DOCUMENT_WORD = /\b(?:dokuman|belge|rapor)\w*\b/u
const WORD_FORMAT = /(?:^|\W)(?:docx|\.docx|word)(?:$|\W)/u
const REQUIREMENT_TARGET = /\b(?:nfr|non[- ]?functional|islevsel olmayan|fonksiyonel olmayan|performans gereksinim|guvenlik gereksinim|raporlama gereksinim)\w*\b/u

export function classifyDocumentArtifactRequest(message: string): DocumentArtifactRouteDecision {
  const text = normalizeIntent(message)
  if (!text) return { artifactRoute: false, enerjisaAnalysisDocx: false, reason: 'none' }

  const createRequested = CREATE_ACTION.test(text)
  const explicitDocx = WORD_FORMAT.test(text) && (FILE_TARGET.test(text) || createRequested)
  const analysisDocumentRequested = createRequested && (
    ANALYSIS_DOCUMENT_TARGET.test(text)
    || ANALYSIS_WORD.test(text) && DOCUMENT_WORD.test(text)
    || /^analiz\w*\s+(?:olustur|hazirla|uret|yaz)\w*/u.test(text)
  )

  if (analysisDocumentRequested) {
    return { artifactRoute: true, enerjisaAnalysisDocx: true, reason: 'enerjisa_analysis_document' }
  }
  if (explicitDocx) {
    return { artifactRoute: true, enerjisaAnalysisDocx: false, reason: 'explicit_docx' }
  }
  return { artifactRoute: false, enerjisaAnalysisDocx: false, reason: 'none' }
}

export function isDocumentRevisionRequest(message: string): boolean {
  const text = normalizeIntent(message)
  if (!text || !REVISE_ACTION.test(text)) return false
  return DOCUMENT_WORD.test(text)
    || ANALYSIS_DOCUMENT_TARGET.test(text)
    || /\b(?:ilgili|mevcut)\s+bolum\w*\b/u.test(text)
}

export function isGroundedRequirementRequest(message: string): boolean {
  const text = normalizeIntent(message)
  return !!text && REQUIREMENT_TARGET.test(text)
}

export const REQUIREMENT_GROUNDING_DIRECTIVE = `[JETWORK_REQUIREMENT_GROUNDING_GUARD:v1]
Bu istek kurumsal gereksinim/NFR tanımlama isteğidir.
- Önce konuşmada zaten doğrulanmış iş kurallarını ve kurumsal bilgi kaynaklarını kullan.
- Kaynakta doğrulanmayan sayısal eşik, SLA, yanıt süresi, hacim/throughput, erişilebilirlik yüzdesi veya kapasite değeri üretme.
- Kaynakta doğrulanmayan ürün/ekran/teknoloji, SAP GUI/Fiori, işlem kodu, log aracı, tablo/alan, rol, yetki, KVKK uygulama detayı, rollback/lock mekanizması gibi teknik ayrıntıları gerçek gereksinim gibi yazma.
- Kurumsal kanıt bulunmayan zorunlu gereksinimleri [AÇIK KONU] olarak belirt. Faydalı ama doğrulanmamış bir yaklaşım sunacaksan açıkça ÖNERİ olarak etiketle.
- Kullanıcının "tanımla" demesi, bilinmeyen kurumsal değerleri varsayma yetkisi değildir.
- Mevcut konu kurumsal bir süreç/hata koduyla ilişkiliyse spesifik iddialardan önce doğrulanmış kurumsal kanıt kullan.`

export function applyRequirementGroundingGuard(message: string): string {
  if (!isGroundedRequirementRequest(message)) return message
  return `${message.trim()}\n\n${REQUIREMENT_GROUNDING_DIRECTIVE}`
}

export function applyEnerjisaAnalysisDocxProfile(message: string, decision: DocumentArtifactRouteDecision) {
  if (!decision.enerjisaAnalysisDocx) return message
  return `${message.trim()}\n\n${ENERJISA_ANALYSIS_DOCX_DIRECTIVE}`
}
