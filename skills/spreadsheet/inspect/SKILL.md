# Skill: spreadsheet/inspect

## Metadata

```json
{
  "key": "spreadsheet/inspect",
  "title": "Spreadsheet inspect",
  "category": "spreadsheet",
  "priority": "P0",
  "description": "Excel/XLS/XLSX/CSV dosyasının sheet, header, veri tipi, formül ve görünüm yapısını değiştirmeden önce inceler.",
  "aliases": ["excel incele", "spreadsheet read", "xlsx inspect", "xls analiz"],
  "tools": ["spreadsheet", "openpyxl", "artifact_tool"]
}
```

## Purpose

E-tablo üzerinde işlem yapmadan önce gerçek workbook yapısını güvenli biçimde anlamak.

## Use when

- Bir e-tablo düzenlenecek veya analiz edilecekse.
- Kolon adları, sheet yapısı veya gerçek veri tipleri bilinmiyorsa.

## Do not use when

- Kullanıcı yalnızca düz metin tablosu verdiğinde.

## Procedure

1. Workbook içindeki tüm sheet adlarını ve kullanılan aralıkları belirle.
2. Gerçek header satırını tespit et; birleşik hücre veya üst başlıkları veri başlığı sanma.
3. Örnek satırlardan veri tiplerini, boşlukları, formülleri ve tarih formatlarını kontrol et.
4. Gizli sheet, filtre, dondurulmuş panel, tablo ve önemli biçimlendirmeleri kaydet.
5. Görev için gerekli anahtar kolonları normalize etmeden önce orijinal değerleri koru.
6. Değişiklik planını workbook yapısına göre oluştur.

## Validation

- Header doğru satırdan mı alındı?
- Formüller veri gibi overwrite edilmeyecek mi?
- Tarih ve sayı biçimleri yanlış parse edilmiyor mu?

## Output contract

- İnceleme sonucunu sonraki spreadsheet skill'ine aktar; kullanıcı istemedikçe teknik dump gösterme.

## Failure handling

- Legacy XLS yapısı doğrudan düzenlenemiyorsa dönüştürme gereksinimini belirt ve orijinali koru.
