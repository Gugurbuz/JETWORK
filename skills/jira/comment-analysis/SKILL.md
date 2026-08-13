# Skill: jira/comment-analysis

## Metadata

```json
{
  "key": "jira/comment-analysis",
  "title": "Jira comment analysis",
  "category": "jira",
  "priority": "P1",
  "description": "Jira yorumlarını tarih sırasıyla analiz ederek karar, blocker, aksiyon, bekleyen soru ve kapsam değişikliği sinyallerini çıkarır.",
  "aliases": ["jira yorum analizi", "comment analysis", "yorumları özetle", "blocker bul"],
  "tools": ["jira", "files"]
}
```

## Purpose
Uzun Jira yorum geçmişini işin mevcut durumunu açıklayan karar ve aksiyonlara dönüştürmek.

## Use when
- Çok sayıda comment içeren issue veya epic incelenecekse.
- Yorum geçmişinde karar, blocker veya bekleyen konu aranıyorsa.

## Do not use when
- Yalnız son yorumun okunması yeterliyse.

## Procedure
1. Yorumları tarih sırasına koy.
2. Otomatik sistem yorumlarını insan yorumlarından ayır.
3. Karar, aksiyon, soru, blocker, kapsam değişikliği ve bilgi notlarını sınıflandır.
4. Sonraki yorumla geçersiz kalan eski kararı güncel karar gibi sunma.
5. Açık aksiyonların sonraki yorumlarda kapanıp kapanmadığını kontrol et.
6. Çelişkili ifadeleri ayrı göster; tek kesin sonuç uydurma.
7. Nihai özette en güncel durum ve halen açık kalan konuları öne çıkar.

## Validation
- Eski bir yorum son karar sanılmadı mı?
- Otomatik mesajlar karar olarak sayılmadı mı?
- Açık aksiyonların durumu sonraki yorumlarla kontrol edildi mi?
- Yorumda olmayan kişi veya tarih eklenmedi mi?

## Output contract
- Güncel durum, önemli kararlar, açık aksiyonlar/blockerlar ve gerekirse kısa zaman çizelgesi.

## Failure handling
- Yorumların sırası veya tarihi güvenilir değilse kronolojik çıkarımı sınırlı güvenle sun.
