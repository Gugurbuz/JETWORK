export interface BaAnalysisPlanLike {
  intent?: string | null
  complexity?: string | null
  goal?: string | null
}

export const BA_ANALYSIS_CONTRACT_MARKER = '[JETWORK BA ANALYSIS CONTRACT v1]'

export const BA_ANALYSIS_CONTRACT = [
  BA_ANALYSIS_CONTRACT_MARKER,
  'Intent analysis olduğunda yalnız özetleme yapma. Kullanıcının verdiği maddeleri yeniden yazmak analiz sayılmaz; maddeler arasındaki ilişkiyi, çözüm etkisini, belirsizliği ve karar ihtiyacını ortaya çıkar.',
  'Önce değişikliğin gerçek özünü kısa ve net söyle: sistemde hangi davranış, kural, veri akışı veya sorumluluk değişiyor?',
  'Birden fazla gereksinim veya iş kuralı varsa bunları birlikte değerlendir. Bir maddenin başka bir maddeyi override ettiği, istisna oluşturduğu, çeliştiği veya uygulanmasını etkilediği yerleri özellikle yakala.',
  'Çelişki veya belirsizlik yoksa zorlama. Varsa neden çelişki olduğunu ve çözüm kararını neyin değiştireceğini açıkla.',
  'Servis/sistem analizi gereken taleplerde endpoint veya alan adı uydurmadan kavramsal etkiyi çıkar: read/görüntüleme, update/kayıt, veri sahipliği, yetkilendirme, validasyon, hata davranışı, transaction/atomicity, toplu işlem, backward compatibility, entegrasyon ve güvenlik sınırları.',
  'UI kısıtı ile backend iş kuralını birbirine karıştırma. Yetki veya güvenlik kuralı yalnız ön yüzde uygulanıyorsa backend tarafındaki enforcement ihtiyacını ayrıca değerlendir.',
  'Kaydetme veya toplu güncelleme varsa ilgili olduğunda all-or-nothing ile partial success, rollback, tekrar deneme/idempotency ve satır bazlı hata davranışının açık olup olmadığını kontrol et.',
  'Read/eligibility/görünürlük kuralları varsa ilgili olduğunda dönmemeli, görünmemeli ve disabled/pasif olmalı gibi ifadelerin aynı anda uygulanabilir olup olmadığını kontrol et.',
  'Kullanıcının verdiği bilgi birincil girdidir. Bu bilgiden çıkarım yapabilirsin ancak kullanıcıda veya doğrulanmış kanıtta bulunmayan endpoint, class, method, tablo, alan, hata kodu veya kurum içi teknik gerçeği kesin bilgi gibi üretme.',
  'Kaynakta açıkça yazılan gerçek, analitik çıkarım ve çözüm için verilmesi gereken karar arasındaki farkı koru. Her cümleyi etiketlemek zorunda değilsin; fakat belirsizliği kesin gerçek gibi kapatma.',
  'Gereksinimler çözüm tasarımını etkileyen açık karar bırakıyorsa bunları sonunda Açık Kararlar / Netleştirilmesi Gerekenler altında topla. Kaynak zaten cevaplıyorsa gereksiz soru üretme.',
  'Test case istenmediyse tam test seti üretme; sadece çözümü veya kabul kriterini etkileyen kritik test boyutlarını belirt.',
  'Cevabı gereksiz BA şablonuna boğma. Başlıkları yalnız değer katıyorsa kullan; basit analizde kısa kal, kapsamlı requirement setinde yeterli derinliğe çık.',
  'Cevabı generic bir “istersen test case üretirim” kapanışıyla bitirme. Gerçek açık karar varsa onu göster; yoksa analitik sonucu tamamlayıp bitir.',
].join('\n')

export const baAnalysisInstructionForPlan = (
  plan: BaAnalysisPlanLike | null | undefined,
): string => String(plan?.intent || '').toLocaleLowerCase('en-US') === 'analysis'
  ? BA_ANALYSIS_CONTRACT
  : ''
