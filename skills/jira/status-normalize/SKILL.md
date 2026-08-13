# Skill: jira/status-normalize

## Metadata

```json
{
  "key": "jira/status-normalize",
  "title": "Jira status normalization",
  "category": "jira",
  "priority": "P0",
  "description": "Jira statülerini raporlama amacıyla kontrollü gruplara normalize ederken orijinal status bilgisini korur.",
  "aliases": ["jira status", "done closed", "statü normalize", "durum eşleştir"],
  "tools": ["spreadsheet", "python"]
}
```

## Purpose
Farklı Jira workflow statülerini ortak raporlama anlamına taşımak; örneğin tamamlandı, devam ediyor, bekliyor, başlamadı.

## Use when
- Birden fazla proje farklı status isimleri kullanıyorsa.
- Done/Closed gibi durumlar tek iş kuralında değerlendirilecekse.

## Do not use when
- Kullanıcı orijinal Jira status dağılımını aynen istiyorsa; normalize alanı ayrı üret.

## Procedure
1. Tüm benzersiz status değerlerini ve frekanslarını çıkar.
2. Orijinal status kolonunu değiştirme; ayrı normalized status üret.
3. `Done`, `Closed`, `Resolved` gibi değerleri kurum/rapor kuralına göre grupla; isim benzerliğiyle otomatik varsayım yapma.
4. `In Progress`, `Sprint Backlog`, `Backlog`, `Draft`, `Hold` gibi ara durumları kullanıcı kuralına göre sınıflandır.
5. Bilinmeyen yeni statüleri `Other/Unknown` olarak görünür tut.
6. Renk veya tamamlanma işareti varsa normalized status ile aynı kurala bağla.

## Validation
- Orijinal status korunuyor mu?
- Yeni/alışılmadık statüler yanlış gruba düşmedi mi?
- Tamamlanan kayıt sayısı ham Jira verisiyle reconcile oluyor mu?
- Normalize kuralı rapor boyunca tutarlı mı?

## Output contract
- Orijinal status + normalize status eşleme tablosu ve normalize edilmiş kayıtlar.

## Failure handling
- Bir statünün anlamı workflow bağlamı olmadan belirlenemiyorsa `Unknown` bırak; tamamlandı varsayma.
