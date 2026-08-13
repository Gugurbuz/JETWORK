# Skill: sap/data-flow-analysis

## Metadata

```json
{"key":"sap/data-flow-analysis","title":"SAP data flow analysis","category":"sap","priority":"P0","description":"SAP sürecindeki verinin girişten kontrol, dönüşüm, saklama ve dış sisteme aktarım adımlarını doğrulanmış kaynaklarla izler.","aliases":["sap veri akışı","data flow","alan nereden geliyor","veri zinciri"],"tools":["knowledge","files"]}
```

## Purpose
Bir alan veya iş verisinin SAP içinde nereden geldiğini ve nereye taşındığını kaynak ilişkileriyle açıklamak.

## Use when
- Bir alanın kaynağı veya hedefi soruluyorsa.
- Entegrasyon ya da veri tutarsızlığı analizi yapılacaksa.

## Procedure
1. İzlenecek veri alanını ve başlangıç bağlamını belirle.
2. Kaynak tablo/nesne veya giriş parametresini doğrula.
3. Dönüşüm, validasyon ve lookup adımlarını kaynakta görüldüğü sırayla çıkar.
4. Kalıcılık noktası varsa hedef tablo/alanı doğrula.
5. Dış sisteme aktarım varsa doğrulanmış entegrasyon adımını ayrı göster.
6. Alan adı benzerliğini veri akışı kanıtı sanma.

## Validation
- Kaynak ve hedef alanlar doğrulanmış mı?
- Dönüşüm adımı atlandı mı?
- Aynı isimli farklı alanlar karıştı mı?

## Output contract
- Kaynak → dönüşüm/kontrol → hedef biçiminde veri akışı.

## Failure handling
- Akışın bir bölümü doğrulanamıyorsa o noktada belirsizliği göster; eksik bağlantıyı uydurma.
