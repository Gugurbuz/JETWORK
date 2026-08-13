# Skill: spreadsheet/change-report

## Metadata

```json
{
  "key": "spreadsheet/change-report",
  "title": "Spreadsheet change report",
  "category": "spreadsheet",
  "priority": "P1",
  "description": "Bir Excel üzerinde yapılan değişiklikleri satır, kolon, eşleşme ve kalite sonuçlarıyla kısa biçimde raporlar.",
  "aliases": ["excel değişiklik özeti", "change report", "ne değişti", "işlem özeti"],
  "tools": ["spreadsheet", "python"]
}
```

## Purpose
Çıktı dosyasında bu çalışma sırasında yapılan değişiklikleri kullanıcı hedefiyle ilişkili biçimde özetlemek.

## Use when
- Mevcut workbook düzenlenmişse.
- Join, durum işaretleme, yeni kolon veya formül ekleme yapılmışsa.

## Do not use when
- Yalnız read-only analiz yapıldıysa ve dosyada değişiklik yoksa.

## Procedure
1. Değişiklik öncesi ve sonrası temel metrikleri karşılaştır: sheet, satır, kolon.
2. Eklenen veya yeniden adlandırılan kolonları listele.
3. Güncellenen hücre/satır sayısını iş kuralı bazında özetle.
4. Join yapıldıysa matched, unmatched ve duplicate sayılarını ekle.
5. Formül veya format değişikliklerini ayrı sınıflandır.
6. QA sonucunu ve varsa çözülmemiş uyarıları belirt.
7. Teknik hücre dökümü yerine kullanıcı hedefiyle ilişkili değişiklikleri öne çıkar.

## Validation
- Rapordaki sayılar gerçek çıktı dosyasıyla aynı mı?
- Unmatched ve duplicate kayıtlar gizlenmedi mi?
- Özet yalnız gerçekten yapılan operasyonları mı anlatıyor?

## Output contract
- 3-8 maddelik kısa değişiklik özeti ve gerektiğinde sayısal QA metrikleri.

## Failure handling
- Önceki sürüm yoksa geçmiş diff uydurma; yalnız bu çalışmada kaydedilen operasyonlardan rapor üret.
