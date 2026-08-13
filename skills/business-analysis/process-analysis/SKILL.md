# Skill: business-analysis/process-analysis

## Metadata

```json
{
  "key": "business-analysis/process-analysis",
  "title": "Process analysis",
  "category": "business-analysis",
  "priority": "P1",
  "description": "Bir iş sürecini olay, aktör, adım, karar, sistem ve istisna ekseninde analiz ederek akış ve problem noktalarını çıkarır.",
  "aliases": ["süreç analizi", "process analysis", "iş akışı", "süreç nasıl çalışıyor"],
  "tools": ["knowledge", "files"]
}
```

## Purpose
Bir sürecin yalnız adımlarını değil, karar mantığını ve aktör/sistem geçişlerini anlaşılır hale getirmek.

## Use when
- Satış, abonelik, teklif, tahliye veya başka uçtan uca süreç analiz edilecekse.
- BPMN/flow tasarımından önce süreç mantığı çıkarılacaksa.

## Do not use when
- Kullanıcı yalnız tek bir iş kuralı veya ekran davranışı soruyorsa.

## Procedure
1. Sürecin tetikleyicisini ve tamamlanma olayını belirle.
2. Aktör ve sistemleri swimlane mantığında ayır.
3. Adımları kronolojik sırada ve doğru granülerlikte çıkar.
4. Karar noktalarında koşul ve alternatif yolları açık yaz.
5. Entegrasyon veya sistem geçişlerini ayrı adım gibi görünür kıl.
6. Hata/istisna, geri dönüş ve manuel müdahale yollarını happy-path'ten ayır.
7. Bekleme, tekrar iş ve gereksiz handoff gibi iyileştirme fırsatlarını kanıta dayalı not et.

## Validation
- Süreç başlangıç/bitişi belli mi?
- Karar koşulları kaynakta doğrulanıyor mu?
- Aynı anda gerçekleşen adımlar yanlış sıraya sokuldu mu?
- İstisna akışları kayboldu mu?

## Output contract
- Yapılandırılmış süreç akışı, kararlar, aktör/sistem sorumlulukları ve önemli problem noktaları.

## Failure handling
- Eksik bölüm varsa akışın geri kalanını uydurma; bilinmeyen geçişi açıkça işaretle.
