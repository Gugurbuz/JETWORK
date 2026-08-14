# Skill: business-analysis/requirement-decomposition

## Metadata

```json
{
  "key": "business-analysis/requirement-decomposition",
  "title": "Requirement decomposition",
  "category": "business-analysis",
  "priority": "P0",
  "description": "Büyük veya karmaşık talebi doğrulanabilir iş kuralları, fonksiyonlar, veri ve entegrasyon parçalarına böler.",
  "aliases": ["talebi parçala", "requirement decomposition", "kapsamı böl", "iş paketleri"],
  "tools": ["knowledge", "files"]
}
```

## Purpose
Tek bir büyük talebi analiz ve test edilebilir alt parçalara ayırmak.

## Use when
- Talep birden fazla süreç veya sistem davranışı içeriyorsa.
- Epic veya kavramsal kapsam daha küçük iş parçalarına ayrılacaksa.

## Do not use when
- Talep zaten tek ve atomik bir değişiklikse.

## Procedure
1. Ana iş hedefini sabit tut; parçalama sırasında yeni hedef ekleme.
2. Kullanıcı akışı, iş kuralı, veri, entegrasyon, raporlama ve operasyonel ihtiyaçları ayrı çıkar.
3. Birbirinden bağımsız doğrulanabilen parçaları belirle.
4. Ortak bağımlılıkları tekrar eden gereksinim gibi çoğaltma; ortak bileşen olarak göster.
5. Her parçaya giriş, davranış ve beklenen sonuç tanımla.
6. Parçalar arasında sıra bağımlılığı varsa belirt.
7. Alt parçaların toplamının orijinal kapsamı karşıladığını kontrol et.

## Validation
- Her alt parça orijinal hedefe bağlanıyor mu?
- Aynı iş kuralı iki pakette çakışıyor mu?
- Önemli bir uçtan uca senaryo kayboldu mu?
- Yeni kapsam eklenmedi mi?

## Output contract
- Mantıksal iş paketleri ve aralarındaki bağımlılıkları gösteren yapı.

## Failure handling
- Parçalar arasında sınır çizilemiyorsa ortak akışı koruyup belirsiz sınırı belirt.
