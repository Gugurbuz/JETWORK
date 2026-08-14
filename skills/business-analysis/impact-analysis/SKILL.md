# Skill: business-analysis/impact-analysis

## Metadata

```json
{
  "key": "business-analysis/impact-analysis",
  "title": "Impact analysis",
  "category": "business-analysis",
  "priority": "P0",
  "description": "Bir değişikliğin süreç, sistem, veri, entegrasyon, kullanıcı, rapor ve test kapsamındaki etkilerini kanıt ve çıkarımı ayırarak analiz eder.",
  "aliases": ["etki analizi", "impact analysis", "neler etkilenir", "değişiklik etkisi"],
  "tools": ["knowledge", "files", "repository"]
}
```

## Purpose
Değişikliğin yalnız talep edilen ekran/metot üzerindeki değil uçtan uca etkilerini görünür kılmak.

## Use when
- Yeni gereksinim mevcut sistem davranışını değiştirecekse.
- Geliştirme öncesi etkilenen nesne ve süreçler belirlenmek isteniyorsa.

## Do not use when
- Yalnız genel fikir üretimi isteniyorsa ve somut mevcut sistem etkisi yoksa.

## Procedure
1. Değişen iş kuralı veya davranışı net cümleyle tanımla.
2. Doğrudan etkilenen süreç adımı, ekran, servis, tablo/alan veya iş nesnesini belirle.
3. Upstream girdiler ve downstream tüketicileri ilişki kanıtı varsa takip et.
4. Entegrasyon, rapor, batch, yetkilendirme ve veri migrasyonu ihtiyacını uygun olduğunda kontrol et.
5. Test etkisini happy-path, negatif ve regresyon alanlarıyla ayır.
6. Doğrulanmış etki ile olası etkiyi açıkça farklı etiketle.
7. Etkinin şiddetini kullanıcı etkisi ve teknik yayılım açısından nitelendir.

## Validation
- Sadece isim benzerliğiyle sahte bağımlılık kurulmadı mı?
- Doğrudan ve dolaylı etki ayrıldı mı?
- Veri/entegrasyon etkisi atlandı mı?
- Çıkarımlar kanıt gibi sunulmadı mı?

## Output contract
- Etkilenen alanlar, etki türü, gerekçe/kanıt ve önerilen regresyon kapsamı.

## Failure handling
- İlişki kanıtı yoksa etkiyi kesinleştirme; olası etki olarak işaretle veya açık bırak.
