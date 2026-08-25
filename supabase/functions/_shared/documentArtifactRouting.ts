export interface DocumentArtifactRouteDecision {
  artifactRoute: boolean
  enerjisaAnalysisDocx: boolean
  reason: 'explicit_docx' | 'enerjisa_analysis_document' | 'none'
}

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

export const ENERJISA_ANALYSIS_DOCX_DIRECTIVE = `[JETWORK_RUNTIME_DOCUMENT_PROFILE:ENERJISA_ANALYSIS_DOCX]
Bu blok JetWork ürün sözleşmesidir. Kullanıcıdan ek bir "Word" veya "DOCX" ifadesi bekleme.

DOSYA TESLİM KURALI
- Bu talebi sohbet içinde düz metin doküman veya Canvas kaydı olarak tamamlama.
- Gerçek bir DOCX artifact üretmek için create_document_file aracını format=docx ile çağır.
- DOCX içeriğini markdown alanında tam doküman gövdesi olarak ver.
- create_document_file metadata alanında mutlaka Talep Adı ve Talep No kayıtlarını gönder. Talep No bilinmiyorsa value=[AÇIK KONU] kullan.
- Kurumsal kapak tablosunu markdown içinde üretme. Kapak, Enerjisa logosu, iç sayfa header/footer, Gizli/Hizmete Özel sınıflandırması, sayfa numarası, renkler ve tablo görsel stili renderer tarafından otomatik uygulanır.
- headerText/footerText alanlarını kurumsal shell'i değiştirmek için kullanma; Enerjisa analiz profilinde renderer bunları yönetir.
- Executor başarılı olmadan dosyanın üretildiğini söyleme.

ENERJİSA İŞ ANALİZİ ŞABLONU
Markdown gövdesinde aşağıdaki yapı ve sıra zorunludur:

## İçindekiler
# İHTİYAÇ ANALİZİ
## 1. ANALİZ KAPSAMI
Başlık/Açıklama tablosunda en az Sistem, Modül, Etkilenen Süreç, Etkilenen Roller, Varsayımlar ve Kısıtlar.
## 2. KISALTMALAR
Kısaltma/Açıklama tablosu.
## 3. İŞ GEREKSİNİMLERİ
### 3.1. İş Kuralları
### 3.2. İş Modeli ve Kullanıcı Gereksinimleri
## 4. FONKSİYONEL GEREKSİNİMLER (FR)
### 4.1. Fonksiyonel Gereksinim Maddeleri
FR-01, FR-02 biçiminde test edilebilir maddeler.
### 4.2. Süreç Akışı
## 5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)
### 5.1. Güvenlik ve Yetkilendirme Gereksinimleri
### 5.2. Performans Gereksinimleri
### 5.3. Raporlama Gereksinimleri
## 6. SÜREÇ RİSK ANALİZİ
### 6.1. Kısıtlar ve Varsayımlar
### 6.2. Bağımlılıklar
### 6.3. Süreç Etkileri
Gerekli olduğunda test senaryolarını | Test ID | Given | When | Then | Negatif Senaryo | Not | kolonlarıyla ekle.
## 7. ONAY
### 7.1. İş Analizi
### 7.2. Değişiklik Kayıtları
### 7.3. Doküman Onay
### 7.4. Referans Dokümanlar
## 8. FONKSİYONEL TASARIM DOKÜMANLARI
### 8.1. Veri Modeli
### 8.2. Teknik Gereksinimler

ANALİZ KALİTESİ
- Önce konuşmadaki ve doğrulanmış kurumsal kanıttaki iş bilgisini kullan; kaynakta olmayan teknik ayrıntıyı gerçek gibi yazma.
- NFR bölümünde kaynakta doğrulanmayan sayısal SLA/performans hedefi, teknoloji/ekran/log aracı, rol, tablo/alan veya regülasyon uygulama detayı yazma; bunları [AÇIK KONU] veya açıkça ÖNERİ olarak işaretle.
- Bilinmeyen alanları [AÇIK KONU], yalnız açıkça kabul edilmiş kabulleri [VARSAYIM] olarak işaretle.
- İş kuralı -> FR -> test senaryosu izlenebilirliğini koru.
- Yeterli bağlam varsa sırf bazı alanlar bilinmiyor diye dokümanı durdurma; kullanılabilir taslağı üret ve eksikleri [AÇIK KONU] bırak.
- Son kullanıcı metninde "Canvas" ifadesini kullanma.`

export function applyEnerjisaAnalysisDocxProfile(message: string, decision: DocumentArtifactRouteDecision) {
  if (!decision.enerjisaAnalysisDocx) return message
  return `${message.trim()}\n\n${ENERJISA_ANALYSIS_DOCX_DIRECTIVE}`
}
