# Skill: sap/object-recognition

## Metadata

```json
{"key":"sap/object-recognition","title":"SAP object recognition","category":"sap","priority":"P0","description":"SAP teknik referanslarını nesne türlerine göre sınıflandırır.","aliases":["sap nesne tanıma","abap object"],"tools":["knowledge","files"]}
```

## Purpose
SAP teknik analizinde verilen referansın türünü doğrulanmış kaynakla belirlemek.

## Procedure
1. Verilen referansı ve bağlamını oku.
2. Knowledge kaynağında karşılığını ara.
3. Doğrulanmış nesne türünü kullan.
4. Doğrulanmayan ayrıntıları uydurma.

## Validation
- Nesne türü kaynakla doğrulandı mı?
- Kaynakta olmayan davranış eklenmedi mi?

## Output contract
- Referans, doğrulanmış nesne türü ve gerekli belirsizlik notu.

## Failure handling
- Doğrulanamıyorsa bilinmiyor olarak bırak.
