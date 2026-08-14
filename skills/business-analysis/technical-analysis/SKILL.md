# Skill: business-analysis/technical-analysis

## Metadata

```json
{
  "key": "business-analysis/technical-analysis",
  "title": "Technical analysis",
  "category": "business-analysis",
  "priority": "P0",
  "description": "Doğrulanmış iş ihtiyacını sistem davranışı, veri, entegrasyon, hata, log ve test etkileriyle teknik analiz yapısına dönüştürür.",
  "aliases": ["teknik analiz", "technical analysis", "teknik tasarım", "sistem etkisi"],
  "tools": ["knowledge", "files", "repository"]
}
```

## Purpose
İş gereksinimi ile gerçek teknik implementasyon alanı arasında izlenebilir köprü kurmak.

## Use when
- Geliştirme öncesi teknik analiz dokümanı hazırlanacaksa.
- Sistem, veri ve entegrasyon etkileri birlikte değerlendirilecekse.

## Do not use when
- Teknik kaynak yokken class/metot/tablo adı uydurmayı gerektirecekse; yalnız fonksiyonel seviyede kal.

## Procedure
1. İş kuralı ve acceptance criteria'yı teknik girdiden ayrı özetle.
2. Doğrulanmış mevcut akışta etkilenen bileşenleri belirle.
3. Giriş/çıkış veri alanları, validasyon, kalıcılık ve entegrasyon davranışını analiz et.
4. Hata mesajı, log, retry, transaction ve rollback ihtiyacını uygun olduğunda değerlendir.
5. Mevcut nesne genişletme ile yeni nesne ihtiyacını kanıta göre ayır.
6. Regresyon ve test kapsamını etkilenen akışlara bağla.
7. Doğrulanmamış teknik isimleri öneri olarak bile kesinmiş gibi yazma.

## Validation
- Her teknik değişiklik bir iş ihtiyacına bağlanıyor mu?
- Kaynakta olmayan nesne adı uyduruldu mu?
- Veri ve entegrasyon etkisi tutarlı mı?
- Hata/rollback senaryosu gerekiyorsa ele alındı mı?

## Output contract
- Etkilenen bileşenler, teknik davranış, veri/entegrasyon etkisi, hata yaklaşımı ve test kapsamı.

## Failure handling
- Teknik kanıt yetersizse doğrulanmış fonksiyonel etkide dur; bilinmeyen implementasyon ayrıntılarını açık bırak.
