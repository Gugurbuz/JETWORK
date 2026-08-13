# Skill: spreadsheet/quality-check

## Metadata

```json
{
  "key": "spreadsheet/quality-check",
  "title": "Spreadsheet quality check",
  "category": "spreadsheet",
  "priority": "P0",
  "description": "E-tablo çıktısını teslimden önce veri, formül, eşleşme, biçim ve dosya bütünlüğü açısından kontrol eder.",
  "aliases": ["excel kalite kontrol", "spreadsheet validate", "xlsx check"],
  "tools": ["spreadsheet", "openpyxl", "python"]
}
```

## Purpose

Spreadsheet çıktısını kullanıcıya vermeden önce veri ve dosya bütünlüğü hatalarını yakalamak.

## Use when

- Her spreadsheet düzenleme veya üretim işinin sonunda.

## Do not use when

- Yalnız dosya okunup yorumlanıyorsa ve çıktı dosyası oluşturulmuyorsa.

## Procedure

1. Workbook'u üretilen dosyadan yeniden aç.
2. Beklenen sheet ve kolonların bulunduğunu doğrula.
3. Satır sayısı, join sayıları ve işaretlenen kayıtları beklenen kurallarla karşılaştır.
4. Formül hücrelerinin yanlışlıkla statik değere dönüşmediğini kontrol et.
5. Tarih, sayı, yüzde ve metin biçimlerinde anomali ara.
6. Boş veya duplicate anahtarları say.
7. Çıktı dosyasının gerçek path ve uzantısını doğrula.

## Validation

- Dosya yeniden açılabiliyor mu?
- İstenen değişikliklerin tamamı uygulanmış mı?
- Beklenmeyen veri kaybı var mı?
- Kullanıcıya verilen özet sayılar dosyayla aynı mı?

## Output contract

- Başarılıysa yalnız gerekli kısa QA özeti; başarısızsa teslim etmeden düzelt.

## Failure handling

- Kritik QA hatası varsa dosyayı başarılıymış gibi sunma.
