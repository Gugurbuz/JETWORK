# Skill: business-analysis/to-be

## Metadata

```json
{
  "key": "business-analysis/to-be",
  "title": "To-be design",
  "category": "business-analysis",
  "priority": "P1",
  "description": "Doğrulanmış ihtiyaç ve mevcut durumdan hedef süreç davranışını, kararları, sistem sorumluluklarını ve geçişleri tasarlar.",
  "aliases": ["to be", "hedef durum", "yeni süreç", "future state"],
  "tools": ["knowledge", "files"]
}
```

## Purpose
Problemi çözen hedef süreci kapsamı aşmadan ve mevcut kısıtları dikkate alarak tanımlamak.

## Use when
- Yeni süreç veya hedef davranış tasarlanacaksa.
- As-is sonrası gelecekteki akış isteniyorsa.

## Do not use when
- Gereksinim henüz anlaşılmamışsa veya mevcut kritik kısıtlar bilinmiyorsa.

## Procedure
1. Çözülecek problemi ve başarı koşulunu sabitle.
2. Korunması gereken mevcut kuralları ve kaldırılacak pain point'leri ayır.
3. Hedef akışın başlangıç, ana adım, karar ve bitiş noktalarını tasarla.
4. Aktör ve sistem sorumluluklarını açıkça dağıt.
5. Veri yaratma/güncelleme ve entegrasyon geçişlerini gereken seviyede belirt.
6. Hata, retry ve manuel fallback ihtiyacını değerlendirmeden happy-path ile yetinme.
7. Tasarım kararlarını kaynakta doğrulanmış zorunluluk ile öneri/inference olarak ayır.

## Validation
- Hedef akış iş problemini gerçekten çözüyor mu?
- As-is'te korunması gereken bir kural yanlışlıkla kayboldu mu?
- Yeni sistem davranışı kaynakta olmayan zorunluluk gibi sunuldu mu?
- Uçtan uca tamamlanma koşulu net mi?

## Output contract
- To-be süreç akışı, rol/sistem sorumlulukları, kritik kurallar ve tasarım varsayımları.

## Failure handling
- Kritik karar verisi yoksa tek çözümü kesinleştirmek yerine alternatifleri ve karar ihtiyacını ayır.
