# Sprint 0 — Davranışı Ölç, Dondur ve Görünür Kıl

## Amaç

Sprint 0'ın amacı JETWORK'ün mevcut AI davranışını değiştirmek değil, Sprint 1 refaktörü öncesinde ölçülebilir bir güvenlik ağı kurmaktır. Bu sprint sonunda ürünün hangi girdide hangi turn kararını verdiği, hangi bağlamı kullandığı ve bilinen açıkların hangileri olduğu tekrar üretilebilir biçimde görünür olmalıdır.

## Değişmezler

- Üretim runtime davranışı değiştirilmeyecek.
- `useMessages`, hafıza kapsamı, retrieval, prompt sırası, `AiTurnDecision` ve artifact üretimi refaktör edilmeyecek.
- Yeni test framework'ü eklenmeyecek; mevcut Vitest kullanılacak.
- JETWORK tek chat modunda kalacak.
- Görünür doküman yüzeyi yalnızca `BA Analiz` ve `Review` olacak.
- `Zero Touch` kapalı kalacak.
- Golden testler dış modele veya ağa çağrı yapmayacak.

## Sprint çıktıları

| Çıktı | Kabul ölçütü |
|---|---|
| Golden runtime harness | Orchestrator'ın saf karar sırasını dış model çağrısı olmadan tekrarlar |
| 30 golden senaryo | Sohbet, keşif, üretim, revizyon, araştırma/review ve sistem/workflow kapsamı |
| Deterministik baseline | Zaman damgası içermez; aynı kod ve fixture ile byte düzeyinde tekrar üretilebilir |
| Bilinen açık testleri | Canlı testte gözlenen bağlam ve kalite sorunları `todo` sözleşmeleri olarak görünür |
| Bağlam envanteri | Kaynaklar, öncelik sırası, kapsam ve riskler tek belgede |
| Tek doğrulama komutu | Golden, known-gap, mevcut test, typecheck ve build zinciri |

## Tamamlanma tanımı

1. `pnpm baseline:sprint0` aynı baseline dosyasını tekrar üretir.
2. `pnpm test:golden` 30 senaryonun eylem sözleşmelerini ve baseline'ı doğrular.
3. `pnpm test:known-gaps` mevcut açığı değiştirmeden kaydeder; Sprint 1 hedefleri `todo` olarak listelenir.
4. `pnpm verify:sprint0` test, typecheck ve production build kontrollerini başarıyla tamamlar.
5. Üretim dosyalarında davranışsal değişiklik yoktur.

## Sprint 1'e geçiş kapısı

Sprint 1'de yapılacak her bağlam, hafıza, retrieval veya prompt değişikliği önce golden farkı üretmelidir. Fark bilinçli ise senaryo beklentisi ve gerekçesi aynı değişiklikte güncellenmelidir; bilinçsiz ise değişiklik kabul edilmemelidir.
