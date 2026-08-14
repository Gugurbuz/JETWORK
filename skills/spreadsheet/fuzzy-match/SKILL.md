# Skill: spreadsheet/fuzzy-match

## Metadata

```json
{
  "key": "spreadsheet/fuzzy-match",
  "title": "Spreadsheet fuzzy match",
  "category": "spreadsheet",
  "priority": "P0",
  "description": "Exact ortak anahtar bulunmadığında ad, açıklama veya kod benzerliği üzerinden kontrollü ve açıklanabilir eşleştirme adayları üretir.",
  "aliases": ["yakın eşleştir", "fuzzy match", "isim benzerliği", "benzer kayıt bul"],
  "tools": ["spreadsheet", "python"]
}
```

## Purpose
Exact join mümkün olmadığında yanlış pozitif üretme riskini yöneterek eşleştirme yapmak.

## Use when
- İki tabloda ortak ID yoksa.
- İsimler yazım farkı, kısaltma veya noktalama nedeniyle birebir eşleşmiyorsa.

## Do not use when
- Güvenilir exact key mevcutsa; `spreadsheet/table-join` kullan.
- Eşleşme sonucu kritik kayıt güncellemesi yaratacaksa tek başına fuzzy skorla kesin kayıt oluşturma.

## Procedure
1. Eşleşmede kullanılacak alanları ve ağırlıkları belirle: ad, kod, şehir, tarih gibi.
2. Karşılaştırma için yardımcı normalize değerler üret; kaynak hücreyi değiştirme.
3. Exact alt eşleşmeleri önce ayır ve fuzzy havuzunu küçült.
4. Benzerlik skorunu tek metin alanına değil mümkünse çoklu kanıta dayandır.
5. En iyi aday ile ikinci aday arasındaki farkı değerlendir; yalnız yüksek skor yeterli değildir.
6. Eşik üstü tekil adayları otomatik, sınırdaki adayları review-needed olarak sınıflandır.
7. Skor, eşleşme nedeni ve kullanılan alanları izlenebilir tut.

## Validation
- Bir kaynak kayıt birden fazla hedefe sessizce bağlanmadı mı?
- İkinci en iyi aday çok yakınsa kesin eşleşme yapılmadı mı?
- Normalize işlemindeki kısaltmalar anlam kaybı yaratmadı mı?
- Örnek doğrulama setinde yanlış pozitif oranı kabul edilebilir mi?

## Output contract
- `matched`, `review-needed`, `unmatched` sınıfları; eşleşenlerde skor ve kısa gerekçe.

## Failure handling
- Güven eşiği karşılanmıyorsa eşleşme uydurma; kaydı review-needed veya unmatched bırak.
