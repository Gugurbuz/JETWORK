# AI BA Engine v1 Sprint Notu

Bu sprintin hedefi JetWork sohbet hattını daha kararlı bir AI BA Assistant davranışına taşımaktır. Mevcut iyi özellikler korunur: niyet belirleme, soru sorma, cevap alma, varsayımla ilerleme, BA dokümanı üretme ve Review sekmesine kalite notu yazma.

## Faz 1 - Motor temizliği

- Görünür doküman yüzeyi `BA Analiz` ve `Review` olarak ele alınır.
- Teknik analiz, test ve flow talepleri ayrı sekme üretmeye zorlanmaz; BA Analiz içinde alt başlık, Review içinde risk/kalite notu olarak taşınır.
- Soru turu, cevap sayısı ve kullanıcıdan gelen "devam / varsayımlarla ilerle" sinyali tek keşif politikasında toplanır.

## Faz 2 - Gelişmiş niyet belirleme

- `src/modules/ai-ba-engine` BA keşif checklist'i ekler.
- Intent classifier artık sadece kategori seçmez; kritik BA bağlamı eksikse bunu sınıflandırmanın içine işler.
- Kullanıcı soru kartlarına cevap veriyorsa bu cevap yeni analiz girdisi kabul edilir.

## Faz 3 - Soru-cevap sistemi

- Soru üretimi problem, hedef, kapsam, iş kuralları, gereksinimler, kabul kriterleri, süreç, veri, entegrasyon, NFR ve risk başlıklarına göre önceliklenir.
- Bir talep için en fazla iki soru turu kuralı korunur.
- Cevap alındığında yeni soru sormak yerine dokümana geçme davranışı güçlendirilir.

## Faz 4 - BA hafızası

- Keşif cevapları `answer mapper` davranışıyla BA girdisi gibi ele alınır.
- Eksik veya belirsiz bilgi varsayım ve açık soru olarak dokümana aktarılır.
- Mevcut proje hafızası akışı bozulmadan yeni BA keşif bağlamı classifier prompt'una verilir.

## Faz 5 - Kalite Kapısı v2

- Her doküman üretiminden sonra `AI BA Engine v1 Kalite Raporu` Review sekmesine yazılır.
- Rapor bölüm bazlı puan verir: keşif/bağlam, kapsam/süreç, gereksinim kalitesi, veri/entegrasyon, NFR/risk, kullanılabilirlik/mesajlar, doküman formatı.
- Eksik keşif alanları ve öncelikli iyileştirmeler görünür hale gelir.
- Review kalite blokları işaretli yazıldığı için sonraki güncellemelerde tekrar tekrar birikmez; mevcut blok yenilenir.

## Faz 6 - BA Assistant UX

- Chat cevabı kısa kalır; detaylar sağ panel dokümanına gider.
- Kullanıcı sadece selam verirse soru kartı üretilmez.
- Kullanıcı "soru sorma", "devam", "uygula", "bu bilgilerle" dediğinde asistan soru döngüsünden çıkar ve taslak üretir.

## Aktif Kod Noktaları

- `src/modules/ai-ba-engine/index.ts`: BA keşif checklist'i, answer mapper, kalite raporu v2.
- `src/services/ai/intentClassifier.ts`: yeni BA keşif bağlamı ve görünür sekme normalizasyonu.
- `src/services/ai/discoveryPolicy.ts`: soru bütçesi, cevap algılama ve varsayımla üretim sinyalleri.
- `src/services/documentPostProcessor.ts`: Review içine bölüm bazlı kalite raporu ekleme.
- `scripts/verify-ai-ba-engine.ts`: deterministik BA motor doğrulama senaryoları.

## Doğrulama Komutları

```bash
npm run verify:ai-ba-engine
npm run lint
npm run build
```

`verify:ai-ba-engine` şu davranışları model çağırmadan kontrol eder:

- Belirsiz talepte kritik BA keşif soruları üretilir.
- "Devam / taslak oluştur" sinyali yeni soru sormayı durdurur.
- Soru kartı cevabı analiz girdisi olarak algılanır.
- Kalite Kapısı v2 çok boyutlu puan üretir.
- Review kalite bloğu tekrar çalıştırıldığında tek kopya kalır.

## Tarayıcı Kontrol Notu

2026-06-08 sabahı production URL üzerinde Chrome ile kontrol edildi:

- `https://jetwork.vercel.app/` açıldı.
- `Misafir Olarak Devam Et` tıklandı.
- Profil tamamlama ekranı geldi.
- Profil tamamlanınca `Projelerim / Yeni Proje` ana ekranına geçildi.

PR preview URL'si Vercel login korumasına düştüğü için yeni AI BA Engine davranışı production'a merge edilmeden canlı sohbet ekranında uçtan uca test edilemedi.

## Kalan Teknik Riskler

- Eski zero-touch ve agent loop kodlarında `code/test/bpmn` alanları geriye dönük uyumluluk için hala bulunuyor.
- Gerçek model davranışı üretim ortamında farklılaşabilir; PR merge sonrası production sohbet senaryosu ile doğrulanmalı.
- Soru seçenekleri classifier tarafında metin tabanlıdır; bir sonraki sprintte doğrudan kart seçenekleri olarak taşınabilir.
