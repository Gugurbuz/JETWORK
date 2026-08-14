# Skill: jira/export-analysis

## Metadata

```json
{
  "key": "jira/export-analysis",
  "title": "Jira export analysis",
  "category": "jira",
  "priority": "P0",
  "description": "Jira XLS/XLSX/CSV exportundaki key, status, sprint, epic, assignee ve tarih alanlarını doğru yorumlar.",
  "aliases": ["jira excel", "jira export", "jira xls analiz"],
  "tools": ["spreadsheet"]
}
```

## Purpose

Jira export dosyasını başka skill'lerin güvenle kullanabileceği normalize edilmiş kayıtlara dönüştürmek.

## Use when

- Jira export dosyası yüklendiğinde.
- JIRA No üzerinden başka dosyayla mapping yapılacaksa.

## Do not use when

- Canlı Jira API verisi doğrudan mevcutsa ve export kullanılmıyorsa.

## Procedure

1. Gerçek header satırını tespit et.
2. Issue Key/JIRA No alanını benzersiz anahtar olarak doğrula.
3. Status değerlerini orijinal haliyle oku; normalize edilmiş alanı ayrı üret.
4. Sprint hücreleri birden fazla değer içeriyorsa ayrıştır ve sıra bilgisini koru.
5. Epic, parent ve issue type alanlarını karıştırma.
6. Tarih alanlarının timezone ve export formatını kontrol et.

## Validation

- Issue Key duplicate mı?
- Status ve sprint alanları kesilmeden okundu mu?
- Birden fazla sprint geçmişi tek string sanılmadı mı?

## Output contract

- Sonraki Jira veya spreadsheet skill'lerinin kullanabileceği normalize edilmiş kayıtlar.

## Failure handling

- Export kolon adı farklıysa içerik örneklerinden alanı doğrula; tahminle yanlış kolon seçme.
