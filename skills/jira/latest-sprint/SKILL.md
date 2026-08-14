# Skill: jira/latest-sprint

## Metadata

```json
{
  "key": "jira/latest-sprint",
  "title": "Jira latest sprint detection",
  "category": "jira",
  "priority": "P0",
  "description": "Bir Jira kaydı birden fazla sprint taşıdıysa en son/geçerli EN-Fast sprint numarasını deterministik çıkarır.",
  "aliases": ["enfast sprint", "latest sprint", "son sprint", "sprint numarası"],
  "tools": ["spreadsheet", "python"]
}
```

## Purpose

Jira exportundaki sprint geçmişinden hedef rapora yazılacak tek ve güvenilir EN-Fast sprint bilgisini üretmek.

## Use when

- Sprint alanında birden fazla sprint geçmişi varsa.
- Hedef Excel'e tek bir “Enfast Sprint” değeri yazılacaksa.

## Do not use when

- Sprint alanı zaten tek ve doğrulanmış değer içeriyorsa.

## Procedure

1. Sprint hücresindeki tüm değerleri ayrıştır.
2. EN-Fast adlandırma patternini diğer sprintlerden ayır.
3. Numara veya sıra bilgisi varsa en yüksek/geçerli sprinti seç; sırf metinde son göründüğü için seçme, format bunu garanti etmiyorsa.
4. Kapalı ve aktif sprint ayrımı exportta bulunuyorsa aktif/en güncel bilgiyi önceliklendir.
5. Seçilen sprintin ham kaynağını gerektiğinde izlenebilir tut.
6. Sprint bulunmayan kaydı boş bırak; uydurma default yazma.

## Validation

- Birden fazla sprintli örneklerde seçim deterministik mi?
- EN-Fast dışı sprint yanlışlıkla alınmadı mı?
- Sprint numarası parse edilirken yıl veya başka sayı seçilmedi mi?

## Output contract

- Tek normalize edilmiş `Enfast Sprint` değeri.

## Failure handling

- Sıralama bilgisi güvenilir değilse belirsiz adayları otomatik seçme.
