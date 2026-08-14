# Skill: spreadsheet/chart

## Metadata

```json
{
  "key": "spreadsheet/chart",
  "title": "Spreadsheet chart generation",
  "category": "spreadsheet",
  "priority": "P1",
  "description": "Excel verisinden doğru grafik türünü seçer, okunabilir eksen/etiketlerle workbook içine karar destek grafiği ekler.",
  "aliases": ["excel grafik", "chart oluştur", "grafik çiz", "visualization"],
  "tools": ["spreadsheet", "openpyxl", "artifact_tool"]
}
```

## Purpose
Veriyi dekoratif değil, karşılaştırma veya trendi doğru anlatan grafikle göstermek.

## Use when
- Kategori karşılaştırması, zaman trendi veya dağılım görselleştirilecekse.
- Kullanıcı Excel içinde grafik istiyorsa.

## Do not use when
- Veri 1-2 sayıdan ibaretse veya grafik tabloya göre daha az anlaşılırsa.

## Procedure
1. Analitik amacı belirle: karşılaştırma, trend, parça-bütün veya ilişki.
2. Amaca uygun grafik seç: bar/column, line, stacked veya scatter; pie'ı yalnız az kategori varsa kullan.
3. Kaynak aralığın header ve toplam satırlarını doğru dahil et.
4. Eksen ölçeğini yanıltıcı biçimde kesme; yüzde ve tarih formatlarını koru.
5. Başlık ve seri adlarını kullanıcı dilinde açık yaz.
6. Çok kategori varsa okunabilirliği korumak için sıralama veya top-N yaklaşımı uygula; kalanları açıkça `Diğer` göster.
7. Grafiğin veri kaynağı değiştiğinde bozulmamasını kontrol et.

## Validation
- Grafik toplamları kaynak tabloyla uyumlu mu?
- Yanlış chart type algıyı bozuyor mu?
- Etiketler taşmadan okunuyor mu?
- Seri adları doğru kolona bağlı mı?

## Output contract
- Workbook içine yerleştirilmiş okunabilir grafik ve gerekirse altında kaynak özet tablo.

## Failure handling
- Uygun grafik türü yoksa tabloyu zorla görselleştirme; özet tabloyu koru.
