# Skill: spreadsheet/table-join

## Metadata

```json
{
  "key": "spreadsheet/table-join",
  "title": "Spreadsheet table join",
  "category": "spreadsheet",
  "priority": "P0",
  "description": "İki veya daha fazla tabloyu JIRA No, ID, kod veya başka bir anahtar üzerinden güvenli biçimde eşleştirir.",
  "aliases": ["excel map", "jira no eşleştir", "table join", "vlookup eşleştir", "dosya map"],
  "tools": ["spreadsheet", "openpyxl", "artifact_tool"]
}
```

## Purpose

Kaynak tablodaki alanları ortak anahtar üzerinden hedef tabloya veri kaybı ve sessiz duplicate üretmeden taşımak.

## Use when

- Kullanıcı “eşleştir”, “map et”, “birleştir” veya “JIRA No üzerinden getir” dediğinde.
- Bir tablodaki durum/sprint gibi alanlar diğer tabloya taşınacaksa.

## Do not use when

- Güvenilir ortak anahtar yoksa; semantik eşleştirme için `spreadsheet/fuzzy-match` kullan.

## Procedure

1. Kaynak ve hedef tabloyu açıkça belirle.
2. Join key kolonlarını iki tarafta trim, case ve görünmeyen karakterler açısından normalize et; orijinal hücreyi değiştirme.
3. Kaynak tarafta duplicate key olup olmadığını kontrol et ve hangi kaydın kazanacağını deterministik kuralla belirle.
4. Exact join uygula; eşleşen, eşleşmeyen ve duplicate kayıt sayılarını tut.
5. Yeni kolon ekleniyorsa mevcut kolon sırasını gereksiz yere bozma.
6. Kullanıcı yalnız belirli durumları işaretlemek istiyorsa join sonucunu iş kuralına göre uygula.

## Validation

- Hedef satır sayısı beklenmedik biçimde değişmedi mi?
- Bir hedef satıra birden fazla kaynak satır sessizce yazılmadı mı?
- Eşleşmeyen kayıtlar raporlandı mı?
- Join key değerleri outputta bozulmadı mı?

## Output contract

- Güncellenmiş workbook ve kısa eşleşme özeti.
- İstenirse eşleşmeyen kayıtları ayrı sheet veya rapor olarak ekle.

## Failure handling

- Duplicate kaynak kayıtlar çelişiyorsa rastgele seçim yapma; deterministik kural kurulamıyorsa kullanıcıya belirt.
