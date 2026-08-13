# Skill: engineering/repository-analysis

## Metadata

```json
{
  "key": "engineering/repository-analysis",
  "title": "Repository analysis",
  "category": "engineering",
  "priority": "P0",
  "description": "Bir kod deposunun mimari sınırlarını, giriş noktalarını, veri akışını, kritik modüllerini ve test yapısını değişiklik öncesi analiz eder.",
  "aliases": ["repo analiz", "repository analysis", "kod tabanı incele", "mimariyi anla"],
  "tools": ["github", "repository", "files"]
}
```

## Purpose
Kod değişikliği önermeden önce gerçek repository yapısını ve mevcut davranışı kanıta dayalı anlamak.

## Use when
- Kullanıcı mevcut kodun nasıl çalıştığını soruyorsa.
- Bir bug fix veya yeni özellik öncesi etkilenen dosyalar belirlenecekse.

## Do not use when
- Repository içeriğine erişim yoksa dosya/class adı tahmin etme.

## Procedure
1. Repository kök yapısını, paketleri ve ana runtime giriş noktalarını belirle.
2. Kullanıcı talebiyle ilişkili sembol, dosya ve testleri arama ile daralt.
3. İlgili çağrı/veri akışını dosyalar arasında takip et.
4. Mevcut feature flag, provider adapter, persistence ve error boundary'leri uygun olduğunda kontrol et.
5. Aynı davranışın legacy/yeni iki implementasyonu varsa hangisinin aktif olduğunu doğrula.
6. İlgili testleri ve CI kontratlarını değişiklik planına dahil et.
7. Okunmayan dosya veya doğrulanmayan sembol hakkında kesin iddia üretme.

## Validation
- Aktif entry point gerçekten doğrulandı mı?
- Benzer isimli legacy dosya aktif sanıldı mı?
- Test ve runtime yolu birbiriyle uyumlu mu?
- Önerilen değişiklik gerçek dosyalara bağlanıyor mu?

## Output contract
- İlgili mimari akış, kritik dosyalar, risk noktaları ve değişiklik için doğrulanmış başlangıç alanı.

## Failure handling
- Repository erişimi yetersizse tahminle kod planı yazma; eksik erişim veya dosyayı belirt.
