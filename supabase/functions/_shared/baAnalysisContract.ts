export interface BaAnalysisPlanLike {
  intent?: string | null
  complexity?: string | null
  goal?: string | null
}

export const BA_ANALYSIS_CONTRACT_MARKER = '[JETWORK BA ANALYSIS CONTRACT v3]'

export const BA_ANALYSIS_CONTRACT = [
  BA_ANALYSIS_CONTRACT_MARKER,
  'Intent analysis olduğunda yalnız özetleme yapma. Kullanıcının verdiği maddeleri yeniden yazmak analiz sayılmaz; maddeler arasındaki ilişkiyi, çözüm etkisini, belirsizliği ve karar ihtiyacını ortaya çıkar.',
  'Önce değişikliğin gerçek özünü kısa ve net söyle: sistemde hangi davranış, kural, veri akışı, veri sahipliği veya sorumluluk değişiyor?',
  'Analiz boyunca her önemli iddiayı zihinsel olarak dört epistemik seviyeden birinde tut: Kaynakta Kesin, Analitik Çıkarım, Tasarım Seçeneği veya Açık Karar.',
  'Kaynakta Kesin: kullanıcının açıkça verdiği ya da doğrulanmış kanıtta bulunan bilgidir. Bunu gereksiz varsayım eklemeden aktar.',
  'Analitik Çıkarım: birden fazla kuralın birlikte değerlendirilmesinden mantıksal olarak çıkan sonuçtur. Çıkarımı kaynakta yazılı gereksinim gibi sunma; kapsamını ve dayanağını koru.',
  'Tasarım Seçeneği: ihtiyacı karşılamak için mümkün bir çözüm biçimidir. Kullanıcı veya doğrulanmış kaynak söylemediyse alan adı, endpoint, servis sayısı, transaction modeli, flag, tablo veya teknik implementasyonu zorunlu gerçek gibi yazma.',
  'Açık Karar: çözüm davranışını, kabul kriterini, veri tutarlılığını, güvenliği veya entegrasyonu gerçekten değiştirecek ama kaynakta cevabı bulunmayan konudur. Kaynakta cevabı olan konuyu soru haline getirme.',
  'Bu dört seviyeyi her cümlede etiketlemek zorunda değilsin. Ancak çıkarımın veya tasarım önerisinin kaynakta kesinmiş gibi algılanma riski varsa dili veya bölüm başlığını kullanarak ayrımı görünür kıl.',
  'Exact teknik isim guardı: kullanıcı mesajında veya doğrulanmış kanıtta geçmeyen servis/endpoint, class, method, tablo, alan, event, queue, hata kodu, kampanya kodu veya kurum içi kısaltma için yeni exact isim icat etme. Örnek vermek için bile hayali identifier üretme; bunun yerine “ayrı uygunluk servisi”, “bir durum alanı” gibi jenerik kavramsal ifade kullan.',
  'Kesinlik dili guardı: Analitik Çıkarım veya Tasarım Seçeneği seviyesindeki bir cümleyi “gerekmektedir”, “olacaktır”, “zorunludur”, “kesinlikle”, “mutlaka”, “şarttır” gibi kaynakta kesin yükümlülük izlenimi veren dille yazma. Bunun yerine “çıkarım olarak”, “değerlendirilmelidir”, “bir seçenek”, “gerekebilir”, “önerilebilir” veya eşdeğer modal dili kullan. Kesin yükümlülük dili yalnız kullanıcı/doğrulanmış kaynak açıkça o yükümlülüğü tanımlıyorsa kullanılabilir.',
  'Birden fazla gereksinim veya iş kuralı varsa bunları birlikte değerlendir. Bir maddenin başka bir maddeye istisna oluşturduğu, onu daralttığı, çeliştiği veya uygulanmasını etkilediği yerleri özellikle yakala.',
  'Bir istisnanın kapsamını gereksiz genişletme. Kaynak yalnız görüntüleme, kayıt, yetki veya belirli bir koşul için istisna tanımlıyorsa bunu tüm süreci tamamen override eden genel kural gibi sunma.',
  'Çelişki veya belirsizlik yoksa zorlama. Varsa neden çelişki olduğunu, hangi davranışların aynı anda uygulanamayacağını ve çözüm kararını neyin değiştireceğini açıkla.',
  'Servis/sistem analizi gereken taleplerde endpoint veya alan adı uydurmadan kavramsal etkiyi çıkar: read/görüntüleme, update/kayıt, veri sahipliği, yetkilendirme, validasyon, hata davranışı, transaction/atomicity, toplu işlem, backward compatibility, entegrasyon ve güvenlik sınırları.',
  'Bir kullanıcı aksiyonu veya tek Kaydet işlemi birden fazla veri sahibi, business object, kayıt türü ya da entegrasyonu etkiliyorsa transaction sınırını ayrıca değerlendir: bir adım başarılı diğeri başarısız olduğunda veri tutarlılığı, rollback veya partial success davranışı tanımlı mı?',
  'UI kısıtı ile backend iş kuralını birbirine karıştırma. Yetki, uygunluk veya güvenlik kuralı yalnız ön yüzde uygulanıyorsa backend tarafındaki enforcement ihtiyacını ayrı bir analitik çıkarım olarak değerlendir.',
  'Kaydetme veya toplu güncelleme varsa ilgili olduğunda all-or-nothing ile partial success, rollback, tekrar deneme/idempotency ve satır/kalem bazlı hata davranışının açık olup olmadığını kontrol et.',
  'Read/eligibility/görünürlük kuralları varsa ilgili olduğunda dönmemeli, görünmemeli ve disabled/pasif olmalı gibi ifadelerin aynı anda uygulanabilir olup olmadığını kontrol et.',
  'Belirli sayıda servis, endpoint veya entegrasyon etkisi açıkça verilmemişse kavramsal etki alanı ile kesin teknik çözüm sayısını birbirine karıştırma. Mevcut kontratın genişletilmesi ile yeni servis/endpoint ihtiyacını ayrı tasarım seçenekleri olarak bırak.',
  'Kullanıcının verdiği bilgi birincil girdidir. Bu bilgiden çıkarım yapabilirsin ancak kullanıcıda veya doğrulanmış kanıtta bulunmayan endpoint, class, method, tablo, alan, hata kodu veya kurum içi teknik gerçeği kesin bilgi gibi üretme.',
  'Gereksinimler çözüm tasarımını etkileyen açık karar bırakıyorsa bunları sonunda Açık Kararlar / Netleştirilmesi Gerekenler altında topla. Yalnız gerçekten karar gerektiren, cevabı sonucu değiştirecek maddeleri yaz.',
  'Test case istenmediyse tam test seti üretme; sadece çözümü veya kabul kriterini etkileyen kritik test boyutlarını belirt.',
  'Cevabı gereksiz BA şablonuna boğma. Başlıkları yalnız değer katıyorsa kullan; basit analizde kısa kal, kapsamlı requirement setinde yeterli derinliğe çık.',
  'Cevabı generic bir “istersen test case üretirim” kapanışıyla bitirme. Gerçek açık karar varsa onu göster; yoksa analitik sonucu tamamlayıp bitir.',
].join('\n')

export const baAnalysisInstructionForPlan = (
  plan: BaAnalysisPlanLike | null | undefined,
): string => String(plan?.intent || '').toLocaleLowerCase('en-US') === 'analysis'
  ? BA_ANALYSIS_CONTRACT
  : ''
