# Skill: business-analysis/business-rule-extraction

## Metadata

```json
{
  "key": "business-analysis/business-rule-extraction",
  "title": "Business rule extraction",
  "category": "business-analysis",
  "priority": "P0",
  "description": "Doküman, talep, kod açıklaması veya süreç metnindeki koşul, karar, zorunluluk ve istisnaları açık iş kurallarına dönüştürür.",
  "aliases": ["iş kuralları", "business rule", "kural çıkar", "validasyon kuralları"],
  "tools": ["knowledge", "files"]
}
```

## Purpose
Dağınık ifadeleri test edilebilir ve izlenebilir iş kurallarına dönüştürmek.

## Use when
- Metinde `eğer`, `yalnızca`, `zorunlu`, `olamaz`, `hariç` gibi karar ifadeleri varsa.
- Teknik kaynaklardan fonksiyonel kural çıkarılacaksa.

## Do not use when
- Kaynak yalnız genel açıklama içeriyor ve kural belirtmiyorsa; boşlukları kural gibi doldurma.

## Procedure
1. Koşul, tetikleyici, kontrol edilen veri, karar ve sonucu ayrı alanlarda belirle.
2. Normal akış ile istisna/engel kurallarını ayır.
3. Aynı kuralın farklı kaynaklardaki tekrarlarını birleştir fakat çelişkileri gizleme.
4. Teknik implementasyon ayrıntısını iş kuralının kendisinden ayır.
5. Varsayılan davranış açıkça kaynakta yoksa `default` uydurma.
6. Her kurala mümkünse kaynak izi veya referans nesnesi bağla.
7. Test edilebilir cümle yapısına dönüştür: koşul → beklenen davranış.

## Validation
- Kural kaynakta gerçekten var mı?
- Koşul ile sonuç ters çevrilmedi mi?
- İstisnalar kaybolmadı mı?
- Teknik detay iş gereksinimi gibi sunulmadı mı?

## Output contract
- Kimliklendirilebilir iş kuralları: koşul, davranış, istisna ve kaynak/kanıt ilişkisi.

## Failure handling
- Kaynaklar çelişiyorsa tek bir kural seçmek yerine çelişkiyi görünür tut.
