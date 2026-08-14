# Skill: sap/method-analysis

## Metadata

```json
{"key":"sap/method-analysis","title":"SAP method analysis","category":"sap","priority":"P0","description":"Doğrulanmış ABAP method kaynağını giriş, kontrol, çağrı, mesaj ve sonuç akışına göre analiz eder.","aliases":["sap method analiz","abap method","metot analizi"],"tools":["knowledge","files"]}
```

## Purpose
Bir ABAP methodunun ne yaptığını kaynak dışına taşmadan iş ve teknik davranış olarak açıklamak.

## Use when
- Method source veya doğrulanmış method kaydı mevcutsa.

## Procedure
1. Method giriş ve kullanılan temel verileri belirle.
2. Ana koşul ve erken çıkış noktalarını sırala.
3. Çağrılan doğrulanmış nesneleri ayrı göster.
4. Üretilen mesaj veya sonuçları kaynakta görüldüğü biçimde ilişkilendir.
5. İş kuralı ile teknik implementasyon ayrıntısını ayır.
6. Kaynakta görünmeyen downstream davranışı tahmin etme.

## Validation
- Koşul yönü doğru yorumlandı mı?
- Çağrılar gerçekten kaynakta var mı?
- Mesaj metni doğrulanmadan uyduruldu mu?

## Output contract
- Amaç, akış, çağrılar, kurallar, çıktılar ve açık belirsizlikler.

## Failure handling
- Kaynak eksikse yalnız görülen bölümü analiz et.
