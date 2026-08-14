# Skill: business-analysis/dependency-analysis

## Metadata

```json
{
  "key": "business-analysis/dependency-analysis",
  "title": "Dependency analysis",
  "category": "business-analysis",
  "priority": "P0",
  "description": "Bir talep veya iş paketinin veri, sistem, ekip, süreç ve sıra bağımlılıklarını doğrudan/dolaylı ayrımıyla çıkarır.",
  "aliases": ["bağımlılık analizi", "dependency analysis", "ön koşullar", "kimden ne bekliyor"],
  "tools": ["knowledge", "files", "repository"]
}
```

## Purpose
Planlama sırasında görünmeyen ön koşulların ve kritik bağımlılıkların gecikme yaratmasını önlemek.

## Use when
- Birden fazla sistem veya ekip içeren geliştirme planlanıyorsa.
- İşlerin hangi sırayla yapılması gerektiği soruluyorsa.

## Do not use when
- Tek başına çalışan, dış girdisi olmayan küçük bir değişiklikte gereksiz detay yaratacaksa.

## Procedure
1. İncelenen işin ihtiyaç duyduğu girişleri, servisleri, verileri ve önceki kararları listele.
2. `blocks`, `blocked by`, `depends on`, `provides to` ilişkilerini yönlü biçimde ayır.
3. Teknik bağımlılık ile organizasyonel koordinasyonu aynı şey gibi göstermeden sınıflandır.
4. Zaman/sıra bağımlılığı varsa hangi koşul gerçekleşmeden sonraki işin başlayamayacağını belirt.
5. Opsiyonel bağımlılık ile zorunlu bağımlılığı ayır.
6. Circular dependency olup olmadığını kontrol et.
7. Kritik path etkisi olan bağımlılıkları öne çıkar.

## Validation
- Bağımlılığın yönü doğru mu?
- Sadece aynı proje içinde oldukları için iki iş bağımlı ilan edilmedi mi?
- Opsiyonel ilişki zorunlu gibi sunulmadı mı?
- Döngüsel bağımlılık görünür mü?

## Output contract
- Bağımlılık matrisi veya yönlü liste: kaynak, hedef, tür, zorunluluk ve gerekçe.

## Failure handling
- Bağımlılık doğrulanamıyorsa kesin ilişki kurma; `possible dependency` olarak ayır.
