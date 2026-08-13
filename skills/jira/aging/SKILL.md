# Skill: jira/aging

## Metadata

```json
{
  "key": "jira/aging",
  "title": "Jira aging analysis",
  "category": "jira",
  "priority": "P1",
  "description": "Jira maddelerinin yaşını oluşturulma, güncellenme ve durum bilgisine göre hesaplar ve en yaşlı açık işleri görünür kılar.",
  "aliases": ["jira yaş", "aging", "en yaşlı iş", "kaç gündür açık"],
  "tools": ["spreadsheet", "python"]
}
```

## Purpose
Backlog veya support işlerinde bekleme süresini doğru referans tarihle ölçmek.

## Use when
- En yaşlı açık kayıtlar isteniyorsa.
- Aging bucket veya gün bazlı bekleme analizi yapılacaksa.

## Do not use when
- Kayıtların yaşam döngüsü tarihleri güvenilir değilse; önce tarih alanlarını doğrula.

## Procedure
1. Analiz referans tarihini ve timezone'u belirle.
2. Açık/kapalı kayıtları normalize status ile ayır.
3. Temel aging için `reference date - created date` hesapla; kullanıcı başka başlangıç tarihi istediyse onu kullan.
4. Kapalı maddelerde kapanış tarihi varsa ayrıca cycle age üret; bugüne kadar yaşlandırma.
5. Yaşı 0-7, 8-30, 31-90, 90+ gibi uygun bucketlara böl; aralıkları açıkça belirt.
6. En yaşlı kayıtları JIRA No, özet, status ve gün sayısıyla sıralı göster.

## Validation
- Gelecek tarihli veya negatif age var mı?
- Kapanmış kayıtlar açık aging toplamına karıştı mı?
- Gün hesabında timezone kaynaklı bir günlük sapma oluştu mu?
- Eksik tarihler ayrı mı tutuluyor?

## Output contract
- Aging gün sayısı, bucket ve gerektiğinde en yaşlı kayıt listesi.

## Failure handling
- Created/closed tarihleri eksikse uydurma tarih kullanma; ilgili kaydı `date missing` olarak ayır.
