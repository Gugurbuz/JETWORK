# Skill: files/file-comparison

## Metadata

```json
{"key":"files/file-comparison","title":"File comparison","category":"files","priority":"P1","description":"İki belge veya veri dosyasını yapı ve içerik farkları açısından karşılaştırır.","aliases":["dosya karşılaştır","file comparison","iki dosya farkı"],"tools":["files","spreadsheet"]}
```

## Purpose
İki dosya arasındaki anlamlı farkları kullanıcıya kısa ve doğrulanabilir biçimde göstermek.

## Procedure
1. Dosya türlerini ve ana yapılarını belirle.
2. Aynı bölüm veya alanları eşleştir.
3. Yeni ve değişen içerikleri ayrı göster.
4. Salt biçim farkı ile veri/anlam farkını ayır.
5. Tablo karşılaştırmasında güvenilir ortak alan varsa satır bazlı eşleştirme kullan.
6. En önemli farkları kullanıcı hedefi açısından öne çıkar.

## Validation
- Aynı içerik yalnız sıra değişti diye farklı sayıldı mı?
- Biçim farkı içerik farkı gibi sunuldu mu?
- Eşleşmeyen bölümler görünür mü?

## Output contract
- Kısa değişiklik özeti ve gerektiğinde yapılandırılmış fark listesi.

## Failure handling
- Dosyalar tam karşılaştırılamıyorsa karşılaştırılabilen bölümü belirt.
