# Skill: spreadsheet/format-preserve

## Metadata

```json
{
  "key": "spreadsheet/format-preserve",
  "title": "Spreadsheet format preserve",
  "category": "spreadsheet",
  "priority": "P0",
  "description": "Mevcut workbook tasarımını, formülleri, hücre stillerini ve kullanıcı düzenini bozmadan veri güncellemesi yapar.",
  "aliases": ["excel formatı koru", "preserve formatting", "tasarımı bozma"],
  "tools": ["spreadsheet", "openpyxl"]
}
```

## Purpose

Mevcut Excel'i veri açısından güncellerken kurumsal görünümü ve workbook davranışını korumak.

## Use when

- Mevcut Excel üzerinde yeni kolon veya değer güncellemesi yapılacaksa.
- Kurumsal şablon veya renk kodları korunmalıysa.

## Do not use when

- Sıfırdan yeni workbook oluşturuluyorsa.

## Procedure

1. Değiştirilecek hücre aralığını minimumda tut.
2. Yeni kolon eklerken komşu kolon stilini uygun şekilde kopyala; formül ve number formatı ayır.
3. Birleşik hücre, filtre, tablo ve freeze pane yapılarını koru.
4. Mevcut koşullu biçimlendirmeleri silme; yeni kural ekleniyorsa çakışmayı kontrol et.
5. Done/Closed gibi durum işaretlerinde kullanıcı tarafından istenen görsel vurguyu tutarlı uygula.
6. Kaydetmeden sonra workbook'un yeniden açılabildiğini doğrula.

## Validation

- Sheet adları ve sırası korunuyor mu?
- Formüller kaybolmadı mı?
- Yeni kolon mevcut tasarımla uyumlu mu?
- Workbook açıldığında bozuk dosya uyarısı oluşmuyor mu?

## Output contract

- Görsel yapısı korunmuş güncel workbook.

## Failure handling

- Stil nesnesi güvenle kopyalanamıyorsa tüm workbook stilini yeniden yazma; yalnız güvenli veri güncellemesini yap ve sınırlamayı belirt.
