# Skill: spreadsheet/pivot

## Metadata

```json
{
  "key": "spreadsheet/pivot",
  "title": "Spreadsheet pivot analysis",
  "category": "spreadsheet",
  "priority": "P1",
  "description": "Tablo verisini yönetim veya operasyon analizi için uygun satır, kolon, değer ve filtre kırılımlarında özetler.",
  "aliases": ["pivot tablo", "özet tablo", "pivot analysis", "kırılım çıkar"],
  "tools": ["spreadsheet", "python", "artifact_tool"]
}
```

## Purpose
Ham veriden karar vermeyi kolaylaştıran doğru aggregation grain'inde özet üretmek.

## Use when
- Durum, sprint, ekip, ürün veya konu bazında dağılım isteniyorsa.
- Çok satırlı veri yönetim özeti haline getirilecekse.

## Do not use when
- Kullanıcı tek bir filtreli liste istiyorsa; pivot gereksiz karmaşıklık yaratır.

## Procedure
1. Ölçü ve boyutları ayır: örneğin issue sayısı ölçü, status/sprint boyut.
2. Count ile sum/average karışıklığını önlemek için aggregation kuralını açık belirle.
3. Boş ve `Unknown` değerleri görünmez biçimde düşürme; ayrı kategori veya açıklama kullan.
4. Tarih alanlarında uygun dönem grain'ini seç: gün/hafta/ay/sprint.
5. Aynı kaydın birden fazla kategoriye sayılmasına yol açan many-to-many ilişkileri kontrol et.
6. Toplamların ham veriyle reconcile olduğunu doğrula.

## Validation
- Grand total ham kayıtlarla uyumlu mu?
- Duplicate kayıtlar ölçüyü şişirmiyor mu?
- Ortalama için payda doğru mu?
- Boş kategoriler sessizce kaybolmadı mı?

## Output contract
- Anlaşılır başlıklarla özet tablo; gerekiyorsa ayrı sheet.

## Failure handling
- Doğru grain belirlenemiyorsa yanıltıcı pivot üretme; ölçü ve boyut belirsizliğini belirt.
