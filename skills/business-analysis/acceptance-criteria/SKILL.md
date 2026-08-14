# Skill: business-analysis/acceptance-criteria

## Metadata

```json
{
  "key": "business-analysis/acceptance-criteria",
  "title": "Acceptance criteria generation",
  "category": "business-analysis",
  "priority": "P0",
  "description": "Doğrulanmış gereksinim ve iş kurallarından test edilebilir, kapsamı aşmayan acceptance criteria üretir.",
  "aliases": ["acceptance criteria", "kabul kriteri", "given when then", "test edilebilir kriter"],
  "tools": ["knowledge", "files"]
}
```

## Purpose
Gereksinimin ne zaman tamamlanmış sayılacağını açık ve test edilebilir biçimde tanımlamak.

## Use when
- Story veya analiz için kabul kriterleri isteniyorsa.
- İş kuralları test senaryosuna yakın davranış koşullarına dönüştürülecekse.

## Do not use when
- Gereksinim henüz belirsizse; önce requirement-understanding veya business-rule-extraction uygula.

## Procedure
1. Yalnız doğrulanmış gereksinim ve kuralları girdi olarak kullan.
2. Her kriterde başlangıç koşulu, eylem/tetikleyici ve gözlenebilir sonucu belirle.
3. Pozitif akış, kritik negatif akış ve sınır durumlarını ayır.
4. Aynı davranışı tekrar eden kriterleri birleştir.
5. UI veya teknik implementasyonu iş kuralı gerektirmiyorsa kriter içine zorla yazma.
6. Ölçülemeyen ifadeleri somut gözlenebilir sonuçlara dönüştür.
7. Kriterlerin tamamının birlikte story kapsamını karşıladığını kontrol et.

## Validation
- Her kriter bağımsız test edilebilir mi?
- Kaynakta olmayan yeni gereksinim eklendi mi?
- Bir kriter birden fazla farklı davranışı aynı anda mı test ediyor?
- Hata/istisna davranışı gerekiyorsa kapsandı mı?

## Output contract
- Numaralı acceptance criteria; uygun olduğunda Given/When/Then formatı.

## Failure handling
- Belirsiz iş kuralını kesin kriter haline getirme; açık soru olarak ayır.
