# Skill: jira/backlog-quality

## Metadata

```json
{
  "key": "jira/backlog-quality",
  "title": "Jira backlog quality",
  "category": "jira",
  "priority": "P1",
  "description": "Backlog maddelerini açıklık, kapsam, bağımlılık, acceptance criteria, tahmin ve hazır olma sinyalleri açısından kalite kontrolünden geçirir.",
  "aliases": ["backlog kalite", "backlog health", "refinement kontrol", "ready mi"],
  "tools": ["jira", "files"]
}
```

## Purpose
Refinement öncesi backlogdaki eksik veya belirsiz maddeleri görünür kılmak.

## Use when
- Sprint planlama/refinement öncesi backlog gözden geçirilecekse.
- Çok sayıda issue için hazır olma kontrolü isteniyorsa.

## Do not use when
- Yalnız tek bir user story'nin metin kalitesi değerlendirilecekse; `jira/story-quality` kullan.

## Procedure
1. Her kayıt için özet, açıklama, issue type, status ve ilişkili alanları kontrol et.
2. İş hedefi ve kullanıcı/değer açıklığının bulunup bulunmadığını değerlendir.
3. Acceptance criteria veya doğrulanabilir bitiş koşulu var mı kontrol et.
4. Bağımlılık, blocker ve dış ekip ihtiyacını işaretle.
5. Efor/tahmin alanı süreçte zorunluysa eksikliği belirt; zorunlu değilse hata sayma.
6. Aşırı büyük veya çok belirsiz maddeleri refinement-needed olarak sınıflandır.
7. Eksik bilgileri issue bazında aksiyona dönüştür.

## Validation
- Tüm issue type'lara aynı şablon zorla uygulanmadı mı?
- Süreçte zorunlu olmayan alanlar gereksiz kalite hatası sayılmadı mı?
- Skor varsa arkasındaki kriterler görünür mü?
- Yalnız metin uzunluğuna bakılarak kalite kararı verilmedi mi?

## Output contract
- Backlog health özeti, hazır olmayan kayıtlar ve kayıt başına en önemli eksik/aksiyon.

## Failure handling
- Projenin Definition of Ready kuralı bilinmiyorsa genel iyi pratikleri kesin kurum standardı gibi sunma.
