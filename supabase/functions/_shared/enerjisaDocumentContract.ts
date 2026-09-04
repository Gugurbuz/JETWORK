export const ENERJISA_DOCUMENT_CONTRACT_VERSION = 'enerjisa-analysis-docx-v2'

export const ENERJISA_DOCUMENT_SECTIONS = [
  'İçindekiler',
  '1. ANALİZ KAPSAMI',
  '2. KISALTMALAR',
  '3. İŞ GEREKSİNİMLERİ',
  '3.1. İş Kuralları',
  '3.2. İş Modeli ve Kullanıcı Gereksinimleri',
  '4. FONKSİYONEL GEREKSİNİMLER (FR)',
  '4.1. Fonksiyonel Gereksinim Maddeleri',
  '4.2. Süreç Akışı',
  '5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)',
  '5.1. Güvenlik ve Yetkilendirme Gereksinimleri',
  '5.2. Performans Gereksinimleri',
  '5.3. Raporlama Gereksinimleri',
  '6. SÜREÇ RİSK ANALİZİ',
  '6.1. Kısıtlar ve Varsayımlar',
  '6.2. Bağımlılıklar',
  '6.3. Süreç Etkileri',
  '7. ONAY',
  '7.1. İş Analizi',
  '7.2. Değişiklik Kayıtları',
  '7.3. Doküman Onay',
  '7.4. Referans Dokümanlar',
  '8. FONKSİYONEL TASARIM DOKÜMANLARI',
  '8.1. Veri Modeli',
  '8.2. Teknik Gereksinimler',
] as const

/**
 * Canonical Enerjisa BA DOCX contract.
 *
 * This contract controls document structure and renderer expectations only.
 * It deliberately does NOT prescribe which skills, knowledge queries, web
 * searches or reasoning sequence the controller must use. Those are semantic
 * decisions owned by the active provider LLM.
 */
export const ENERJISA_ANALYSIS_DOCX_DIRECTIVE = `[JETWORK_RUNTIME_DOCUMENT_PROFILE:ENERJISA_ANALYSIS_DOCX]
Contract-Version: ${ENERJISA_DOCUMENT_CONTRACT_VERSION}
Bu blok JetWork ürün sözleşmesidir. Kullanıcıdan ek bir "Word" veya "DOCX" ifadesi bekleme.

DOSYA TESLİM KURALI
- Bu talebi sohbet içinde düz metin doküman olarak tamamlama.
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
- Şablon araştırma planı değildir. Knowledge, web ve skill seçimlerini bu bölüm sırasından türetme; controller hedefe göre dinamik karar versin.
- Önce konuşmadaki ve doğrulanmış kurumsal kanıttaki iş bilgisini kullan; kaynakta olmayan teknik ayrıntıyı gerçek gibi yazma.
- NFR bölümünde kaynakta doğrulanmayan sayısal SLA/performans hedefi, teknoloji/ekran/log aracı, rol, tablo/alan veya regülasyon uygulama detayı yazma; bunları [AÇIK KONU] veya açıkça ÖNERİ olarak işaretle.
- Bilinmeyen alanları [AÇIK KONU], yalnız açıkça kabul edilmiş kabulleri [VARSAYIM] olarak işaretle.
- İş kuralı -> FR -> test senaryosu izlenebilirliğini koru.
- Talep dokümanını tek başına mevcut sistem gerçeği sayma. Mevcut durum, etkilenen sistemler, sistem sahipliği ve entegrasyon iddiaları için gerekli kanıtı controller uygun capabilitylerle toplasın.
- Kanıt, kullanıcı talebi, analitik çıkarım, öneri ve açık kararı birbirinden ayır.
- Yeterli bağlam varsa sırf bazı alanlar bilinmiyor diye dokümanı durdurma; kullanılabilir taslağı üret ve eksikleri [AÇIK KONU] bırak.
- Final artifact öncesinde maddi çelişki, kanıtsız kritik iddia, eksik sistem etkisi ve izlenebilirlik açığı kalıp kalmadığını gözden geçir; gerekiyorsa re-plan et.
- Artifact üretildikten sonraki kısa sohbet mesajında varsa en fazla 5 kritik karar sorusunu kullanıcıya açıkça sor.`
