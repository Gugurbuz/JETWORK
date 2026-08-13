# Skill: sap/diagnosis

## Metadata

```json
{"key":"sap/diagnosis","title":"SAP technical diagnosis","category":"sap","priority":"P0","description":"SAP teknik belirtilerini doğrulanmış kaynaklarla neden-sonuç ilişkisi içinde analiz eder.","aliases":["sap teşhis","sap analiz","neden oluşuyor"],"tools":["knowledge","files"]}
```

## Purpose
Gözlenen SAP davranışının doğrulanabilen nedenini kaynak dışına taşmadan açıklamak.

## Procedure
1. Gözlenen davranışı ve bağlamı netleştir.
2. İlgili teknik kaynağı knowledge içinde doğrula.
3. Kaynaktaki koşul ve kullanılan veriyi incele.
4. Doğrudan kanıt ile çıkarımı ayrı tut.
5. Uygun doğrulama adımını öner.
6. Kaynakta olmayan teknik ayrıntı ekleme.

## Validation
- Koşul kaynakta görülüyor mu?
- Çıkarım kanıt gibi sunuldu mu?
- Öneri doğrulanmış bulguyla ilişkili mi?

## Output contract
- Doğrulanmış bulgu, olası neden ve gerekli doğrulama adımı.

## Failure handling
- Kanıt yeterli değilse kesin teşhis verme.
