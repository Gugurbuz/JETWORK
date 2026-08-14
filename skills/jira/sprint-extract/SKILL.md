# Skill: jira/sprint-extract

## Metadata

```json
{
  "key": "jira/sprint-extract",
  "title": "Jira sprint extraction",
  "category": "jira",
  "priority": "P0",
  "description": "Jira exportundaki tek veya çoklu sprint alanlarını ayrıştırır, sprint adı, numarası ve geçmişini kayıpsız biçimde normalize eder.",
  "aliases": ["sprint ayrıştır", "jira sprint", "sprint parse", "sprint geçmişi"],
  "tools": ["spreadsheet", "python"]
}
```

## Purpose
Jira sprint hücresini tek bir düz metin sanmadan bütün sprint üyeliklerini kullanılabilir yapıya dönüştürmek.

## Use when
- Sprint alanında birden fazla değer veya Jira export metadata'sı varsa.
- Son sprint, sprint geçmişi veya sprint bazlı analiz yapılacaksa.

## Do not use when
- Kaynak veri zaten her sprint üyeliğini ayrı satır/alan olarak güvenilir sunuyorsa.

## Procedure
1. Sprint alanının gerçek formatını örnek satırlardan belirle.
2. Çoklu sprint değerlerini delimiter veya Jira export yapısına göre ayrıştır.
3. Sprint adı, varsa numara ve durum bilgisini ayrı alanlarda tut.
4. EN-Fast gibi hedef isim patternlerini diğer board sprintlerinden ayır.
5. Kaynak sırayı koru fakat sıranın kronolojik olduğunu ayrıca doğrulamadan son sprint kararı verme.
6. Boş sprint değerini `no sprint` olarak koru; başka sprintten tahmin etme.

## Validation
- Çoklu sprint değerlerinin hiçbiri kaybolmadı mı?
- Sprint adındaki yıl/numara yanlış alan olarak parse edilmedi mi?
- Board adı ile sprint adı karışmadı mı?
- Boş sprintler görünür mü?

## Output contract
- Kayıt başına normalize edilmiş sprint listesi; sonraki `jira/latest-sprint` veya sprint analiz skill'ine hazır yapı.

## Failure handling
- Format tutarsızsa ham sprint değerini koru ve parse edilemeyen satırları işaretle.
