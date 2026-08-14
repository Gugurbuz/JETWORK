# Skill: spreadsheet/formula

## Metadata

```json
{
  "key": "spreadsheet/formula",
  "title": "Spreadsheet formula generation",
  "category": "spreadsheet",
  "priority": "P1",
  "description": "Excel formüllerini workbook yapısına uygun, kopyalanabilir ve referansları doğrulanmış biçimde üretir veya günceller.",
  "aliases": ["excel formül", "formula generation", "formül ekle", "hesaplama kolonu"],
  "tools": ["spreadsheet", "openpyxl"]
}
```

## Purpose
Hesaplama mantığını statik değer basmak yerine doğru Excel formülü olarak kurmak.

## Use when
- Yeni hesaplama kolonu gerekiyorsa.
- Mevcut formül bir aralığa güvenli biçimde yayılacaksa.

## Do not use when
- Kullanıcı özellikle yalnız sonuç değerini istiyorsa veya hedef format formül desteklemiyorsa.

## Procedure
1. Mevcut workbook'taki formül dilini, tablo referansını ve ayırıcı davranışını incele.
2. İlk veri satırı için formülü göreli/mutlak referans ihtiyacına göre kur.
3. Structured reference kullanılıyorsa aynı tablo stilini koru.
4. Boş veya hata durumlarını `IF`, `IFERROR` benzeri mantıkla iş kuralına uygun ele al.
5. Formülü hedef aralığa referans kayması kontrol edilerek yay.
6. Mevcut formülleri overwrite etmeden önce gerçekten değişiklik gerektiğini doğrula.

## Validation
- `$` mutlak referansları doğru mu?
- Formül aşağı kopyalandığında doğru satıra bakıyor mu?
- Bölme-sıfır/boş değer davranışı beklenen sonucu veriyor mu?
- Dosya yeniden açıldığında formül stringi bozulmamış mı?

## Output contract
- Formülü korunmuş workbook ve kısa hesaplama mantığı özeti.

## Failure handling
- Hesaplama kuralı belirsizse formül uydurma; gerekli iş kuralını açık konu olarak belirt.
