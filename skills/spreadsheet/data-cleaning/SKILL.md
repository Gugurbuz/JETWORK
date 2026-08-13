# Skill: spreadsheet/data-cleaning

## Metadata

```json
{
  "key": "spreadsheet/data-cleaning",
  "title": "Spreadsheet data cleaning",
  "category": "spreadsheet",
  "priority": "P1",
  "description": "E-tablo verisini analiz veya eşleştirme öncesi boşluk, görünmeyen karakter, tutarsız tip ve hatalı boş değerler açısından temizler.",
  "aliases": ["excel temizle", "data cleaning", "veri temizleme", "boşluk düzelt"],
  "tools": ["spreadsheet", "openpyxl", "python"]
}
```

## Purpose
Kirli veriyi düzeltirken iş anlamını ve orijinal izlenebilirliği korumak.

## Use when
- Aynı değer farklı boşluk/case/format nedeniyle eşleşmiyorsa.
- Sayı, tarih veya kod alanları karışık tipteyse.
- Null, boş string ve görsel boşluk ayrımı problem yaratıyorsa.

## Do not use when
- Kullanıcı ham verinin aynen korunmasını özellikle istiyorsa; bu durumda normalize edilmiş yardımcı kolon kullan.

## Procedure
1. Temizlenecek kolonları göreve göre sınırla; tüm workbook'u körlemesine normalize etme.
2. Baştaki/sondaki boşlukları ve görünmeyen Unicode karakterlerini tespit et.
3. Kod/ID kolonlarında leading zero kaybını önle; sayıya çevirmeden önce semantiği kontrol et.
4. Tarih ve sayı dönüşümünü locale ve gerçek örneklerle doğrula.
5. Null, boş string, `-`, `N/A` gibi placeholder değerleri iş kuralına göre normalize et.
6. Orijinal değer kritikse ayrı raw kolon veya değişiklik logu tut.
7. Temizlik sonrası unique/null dağılımlarını yeniden kontrol et.

## Validation
- ID/kod değerlerinin leading zero'ları korunuyor mu?
- Tarih formatı gün/ay karışıklığı yaratmadı mı?
- Gerçek metin değerleri yanlışlıkla null yapılmadı mı?
- Temizlik satır sayısını değiştirmedi mi?

## Output contract
- Temizlenmiş veri ve gerekiyorsa hangi kolonlarda ne tür normalizasyon yapıldığını özetleyen değişiklik kaydı.

## Failure handling
- Bir değerin tipi belirsizse zorla dönüştürme; orijinal değeri koru ve belirsizliği işaretle.
