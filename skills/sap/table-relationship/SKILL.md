# Skill: sap/table-relationship

## Metadata

```json
{"key":"sap/table-relationship","title":"SAP table relationship","category":"sap","priority":"P1","description":"SAP tablo ve alanları arasındaki doğrulanmış ilişkiyi join alanı, yön ve kullanım bağlamıyla açıklar.","aliases":["sap tablo ilişkisi","table relationship","tablo join","alan ilişkisi"],"tools":["knowledge","files"]}
```

## Purpose
İki SAP veri nesnesi arasındaki ilişkiyi isim benzerliğiyle değil doğrulanmış teknik kanıtla kurmak.

## Use when
- Bir verinin hangi tablo/alan zincirinden bulunduğu soruluyorsa.
- Teknik analiz için join veya lookup ilişkisi gerekiyorsa.

## Procedure
1. Başlangıç ve hedef tablo/alanı doğrula.
2. Kaynakta görülen ortak alan veya ara nesneyi belirle.
3. İlişkinin one-to-one, one-to-many veya tarihsel olabileceğini veri bağlamıyla değerlendir.
4. Validity date, status veya client gibi ek filtreler varsa görünür tut.
5. Ara tablo gerekiyorsa zinciri adım adım göster.
6. Kaynakta olmayan foreign-key ilişkisi uydurma.

## Validation
- Join alanları gerçekten kaynakta ilişkili mi?
- Tarih/geçerlilik filtresi atlandı mı?
- One-to-many ilişki tek kayıt gibi yorumlandı mı?

## Output contract
- Tablo/alan ilişkisi, join yolu ve gerekli filtre/koşullar.

## Failure handling
- İlişki doğrulanamıyorsa olası join önermeyi kesin gerçek gibi sunma.
