# Skill: spreadsheet/schema-detect

## Metadata

```json
{
  "key": "spreadsheet/schema-detect",
  "title": "Spreadsheet schema detect",
  "category": "spreadsheet",
  "priority": "P0",
  "description": "Bir workbook veya tablo içindeki gerçek header, anahtar kolon, veri alanı ve tablo sınırlarını güvenli biçimde tespit eder.",
  "aliases": ["excel şema bul", "header tespit", "kolon yapısı", "schema detect"],
  "tools": ["spreadsheet", "openpyxl", "artifact_tool"]
}
```

## Purpose
Spreadsheet üzerinde join, filtre, formül veya raporlama yapmadan önce veri şemasını doğru kurmak.

## Use when
- Header satırı açık değilse veya üstte açıklama/başlık satırları varsa.
- Birden fazla tablo aynı sheet içinde bulunuyorsa.
- Anahtar kolonun adı farklı varyasyonlarla gelebiliyorsa.

## Do not use when
- Şema zaten güvenilir biçimde doğrulanmış ve aynı dosya üzerinde değişmeden devam ediliyorsa.

## Procedure
1. Kullanılan hücre aralığını ve boş satır/kolon sınırlarını incele.
2. Header adaylarını doluluk, benzersizlik ve alt satır veri tipleriyle puanla.
3. Birleşik hücreleri ve görsel üst başlıkları gerçek alan adı sanma.
4. Her kolon için örnek değer, veri tipi, boşluk oranı ve benzersizlik oranı çıkar.
5. JIRA No, ID, kod gibi potansiyel anahtar kolonları duplicate ve null oranıyla doğrula.
6. Birden fazla tablo varsa tablo sınırlarını ayrı şemalar halinde tut.
7. Şema kararını sonraki skill'lere aktar; orijinal kolon adlarını kaybetme.

## Validation
- Header satırı veri satırıyla karışmadı mı?
- Anahtar kolon gerçekten yeterince benzersiz mi?
- Birleşik hücre kaynaklı sahte kolon üretilmedi mi?
- Tablo sınırları satır kaybı yaratmıyor mu?

## Output contract
- Sheet, header satırı, kolon listesi, tip özeti ve güvenilir anahtar adaylarından oluşan kompakt şema.

## Failure handling
- İki header adayı eşit derecede makulse otomatik seçimi zorlamadan belirsizliği belirt veya görevin güvenli kısmıyla devam et.
