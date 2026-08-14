# Skill: business-analysis/as-is

## Metadata

```json
{
  "key": "business-analysis/as-is",
  "title": "As-is analysis",
  "category": "business-analysis",
  "priority": "P1",
  "description": "Mevcut sürecin aktör, adım, sistem, veri, karar ve problem noktalarını doğrulanmış kaynaklardan yapılandırır.",
  "aliases": ["as is", "mevcut durum", "mevcut süreç", "current state"],
  "tools": ["knowledge", "files"]
}
```

## Purpose
Yeni çözüm tasarımından önce mevcut davranışı ve gerçek problem noktalarını doğru anlamak.

## Use when
- Mevcut süreç dokümante edilecekse.
- Değişiklik öncesi hangi sistem/adımların bugün nasıl çalıştığı soruluyorsa.

## Do not use when
- Kullanıcı yalnız hedef çözümü tarif etmek istiyorsa ve mevcut durum bilgisi gerekmiyorsa.

## Procedure
1. Sürecin başlangıç ve bitiş olaylarını belirle.
2. Aktörları ve her aktörün yaptığı adımları sırala.
3. Her adımda kullanılan sistem, veri ve entegrasyonu kaynak varsa bağla.
4. Karar noktaları, validasyonlar, beklemeler ve manuel adımları ayır.
5. Problem, tekrar iş, gecikme ve hata noktalarını gözlenebilir kanıtla belirt.
6. Kaynakta olmayan bağlantıları tamamlamak için varsayım üretme.
7. Mevcut durum ile hedef çözümü aynı akışta karıştırma.

## Validation
- As-is adımları gerçekten mevcut davranışı mı anlatıyor?
- Problem yorumu ile kaynakta gözlenen gerçek ayrıldı mı?
- Aktör/sistem geçişleri eksiksiz mi?
- Sürecin başlangıç ve bitişi net mi?

## Output contract
- Mevcut durum akışı, aktör/sistem matrisi ve başlıca pain point'ler.

## Failure handling
- Kaynak kapsamı eksikse bilinen akışı göster, eksik bölümleri açıkça `unknown` olarak ayır.
